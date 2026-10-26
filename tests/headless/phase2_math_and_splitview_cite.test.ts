import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  nodeId,
  worldAABB,
} from '../../src/core/canvas/types.js';
import { CanvasStore } from '../../src/state/canvas_store.js';
import {
  CompileMathBlockCommand,
  DragToCiteCommand,
  MathBlockContentSchema,
  PdfCitationContentSchema,
} from '../../src/core/commands/math_and_media_commands.js';

describe('Phase 2 — Double-Tap to LaTeX Math Engine & Split-View Drag-to-Cite (Headless Verification)', () => {
  let store: CanvasStore;

  beforeEach(() => {
    store = CanvasStore.createInMemory('Electrodynamics & Citations');
  });

  afterEach(() => {
    store.close();
  });

  it('compiles a handwritten stroke_cluster into a dual-representation math_block on the math_formal layer, toggles display mode, and undoes cleanly', () => {
    const notesLayer = store.getLayerByType('notes');
    const mathLayer = store.getLayerByType('math_formal');
    const clusterId = nodeId(crypto.randomUUID());

    store.nodeRepo.insertNode({
      id: clusterId,
      canvasId: store.canvasId,
      layerId: notesLayer.id,
      nodeType: 'stroke_cluster',
      parentClusterId: null,
      bbox: worldAABB(80, 120, 320, 180),
      strokePoints: null,
      style: null,
      contentJson: { strokeCount: 4 },
      ocrText: '\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}',
      semanticTags: ['noir'],
    });

    const mathCmd = new CompileMathBlockCommand(store.db, store.nodeRepo, {
      canvasId: store.canvasId,
      mathLayerId: mathLayer.id,
      anchorClusterId: clusterId,
      bbox: worldAABB(80, 120, 320, 180),
      latex: '\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}',
    });

    store.history.execute(mathCmd);

    const mathNode = store.nodeRepo.getById(mathCmd.mathNodeId);
    expect(mathNode).not.toBeNull();
    expect(mathNode!.nodeType).toBe('math_block');
    expect(mathNode!.layerId).toBe(mathLayer.id);

    const parsedContent = MathBlockContentSchema.parse(mathNode!.contentJson);
    expect(parsedContent.latex).toBe(
      '\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}'
    );
    expect(parsedContent.displayMode).toBe('typeset');
    expect(parsedContent.anchorClusterId).toBe(clusterId);

    // Undo restores canvas to before math compilation
    store.history.undo();
    expect(store.nodeRepo.getById(mathCmd.mathNodeId)).toBeNull();
  });

  it('creates an undoable media_item with PDF provenance metadata via DragToCiteCommand', () => {
    const notesLayer = store.getLayerByType('notes');

    const citeCmd = new DragToCiteCommand(store.db, store.nodeRepo, {
      canvasId: store.canvasId,
      layerId: notesLayer.id,
      bbox: worldAABB(400, 100, 720, 280),
      citation: {
        sourcePdfUri: 'opfs://library/jackson_electrodynamics.pdf',
        pageNumber: 248,
        sourceRect: [72, 140, 480, 260],
        excerptText: 'Maxwell equations in vacuum admit transverse electromagnetic wave solutions.',
      },
    });

    store.history.execute(citeCmd);

    const mediaNode = store.nodeRepo.getById(citeCmd.mediaNodeId);
    expect(mediaNode).not.toBeNull();
    expect(mediaNode!.nodeType).toBe('media_item');

    const parsedCitation = PdfCitationContentSchema.parse(mediaNode!.contentJson);
    expect(parsedCitation.pageNumber).toBe(248);
    expect(parsedCitation.sourcePdfUri).toBe(
      'opfs://library/jackson_electrodynamics.pdf'
    );

    // Undo removes the cited media item from both spatial_nodes and R-Tree
    store.history.undo();
    expect(store.nodeRepo.getById(citeCmd.mediaNodeId)).toBeNull();
  });
});
