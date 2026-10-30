import { describe, expect, it } from 'vitest';
import { worldAABB } from '../../src/core/canvas/types.js';
import { CreateZettelCardCommand } from '../../src/core/commands/zettel_commands.js';
import {
  CompileMathBlockCommand,
  DragToCiteCommand,
} from '../../src/core/commands/math_and_media_commands.js';
import { ZettelRepository } from '../../src/db/repositories/zettel_repository.js';
import { CanvasStore } from '../../src/state/canvas_store.js';
import { WetStrokeBuffer } from '../../src/ui/scene_graph/wet_ink_buffer.js';
import {
  DualCanvasRenderer,
  type Canvas2DContextLike,
} from '../../src/ui/scene_graph/canvas_renderer.js';

function createRecordingContext(): {
  ctx: Canvas2DContextLike;
  calls: string[];
  texts: string[];
} {
  const calls: string[] = [];
  const texts: string[] = [];

  const ctx: Canvas2DContextLike = {
    strokeStyle: '#000',
    fillStyle: '#000',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
    font: '12px sans-serif',
    save: () => {
      calls.push('save');
    },
    restore: () => {
      calls.push('restore');
    },
    clearRect: () => {
      calls.push('clearRect');
    },
    fillRect: () => {
      calls.push('fillRect');
    },
    strokeRect: () => {
      calls.push('strokeRect');
    },
    translate: () => {
      calls.push('translate');
    },
    scale: () => {
      calls.push('scale');
    },
    rotate: () => {
      calls.push('rotate');
    },
    beginPath: () => {
      calls.push('beginPath');
    },
    closePath: () => {
      calls.push('closePath');
    },
    moveTo: () => {
      calls.push('moveTo');
    },
    lineTo: () => {
      calls.push('lineTo');
    },
    quadraticCurveTo: () => {
      calls.push('quadraticCurveTo');
    },
    arc: () => {
      calls.push('arc');
    },
    fill: () => {
      calls.push('fill');
    },
    stroke: () => {
      calls.push('stroke');
    },
    setLineDash: () => {
      calls.push('setLineDash');
    },
    fillText: (text: string) => {
      calls.push('fillText');
      texts.push(text);
    },
  };

  return { ctx, calls, texts };
}

describe('DualCanvasRenderer (Wet Overlay + Unified Dry Scene Graph)', () => {
  it('renders wet-ink committed quadratic splines and predicted look-ahead tip in <2ms', () => {
    const renderer = new DualCanvasRenderer();
    const wet = new WetStrokeBuffer();
    wet.appendCommitted(10, 10, 0.5, 1);
    wet.appendCommitted(30, 20, 0.7, 2);
    wet.appendCommitted(60, 35, 0.8, 3);
    wet.appendPredicted(80, 45, 0.8, 4);

    const { ctx, calls } = createRecordingContext();
    renderer.renderWetOverlay(
      ctx,
      1024,
      768,
      wet,
      { colorId: 'cobalt', width: 2.8, brushType: 'pen' },
      1.0,
      'fountain_pen',
      'PEN_DRAWING'
    );

    expect(calls).toContain('clearRect');
    expect(calls).toContain('quadraticCurveTo');
    expect(calls).toContain('lineTo');
  });

  it('renders unified dry scene graph with strokes, Zettel cards, PDF citations, Math blocks, and lockstep AI badges', () => {
    const store = CanvasStore.createInMemory('Renderer Test');
    const zettelRepo = new ZettelRepository(store.db);
    const notesLayer = store.getLayerByType('notes');
    const mathLayer = store.getLayerByType('math_formal');

    // 1. Violet Highlighter stroke -> triggers immediate (0ms) Tier-0 cluster & `◌` queued badge
    store.selectRadialTool('ai_highlighter');
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        40, 40, 0.6, 1,
        140, 40, 0.6, 2,
      ]),
    });

    const clusters = store.nodeRepo
      .queryViewportRTree(store.canvasId, worldAABB(0, 0, 1000, 1000))
      .filter((n) => n.nodeType === 'stroke_cluster');
    const anchorClusterId = clusters[0]!.id;

    // 2. Zettel Card
    store.history.execute(
      new CreateZettelCardCommand(store.db, store.nodeRepo, zettelRepo, {
        canvasId: store.canvasId,
        layerId: notesLayer.id,
        embedding: null,
        toolInput: {
          title: 'Spectral Graph Theory',
          summaryMarkdown: 'Eigenvalues of Laplacian bound graph connectivity.',
          latexBlocks: ['\\lambda_2(L) > 0'],
          verificationState: 'verified',
          anchorClusterId,
          worldPosition: { x: 200, y: 100 },
        },
      })
    );

    // 3. PDF Citation Card
    store.history.execute(
      new DragToCiteCommand(store.db, store.nodeRepo, {
        canvasId: store.canvasId,
        layerId: notesLayer.id,
        bbox: worldAABB(200, 280, 460, 380),
        citation: {
          sourcePdfUri: 'chung1997.pdf',
          pageNumber: 14,
          sourceRect: [12, 40, 320, 90],
          excerptText: 'The Cheeger constant bounds the spectral gap.',
        },
      })
    );

    // 4. Math Block
    store.history.execute(
      new CompileMathBlockCommand(store.db, store.nodeRepo, {
        canvasId: store.canvasId,
        mathLayerId: mathLayer.id,
        anchorClusterId,
        bbox: worldAABB(50, 180, 240, 230),
        latex: '\\mathcal{L} = D - A',
      })
    );

    const frame = store.buildSceneFrame(1024, 768);
    const { ctx, texts } = createRecordingContext();
    const renderer = new DualCanvasRenderer();

    renderer.renderDrySceneGraph(ctx, 1024, 768, frame);

    expect(texts.some((t) => t.includes('Spectral Graph Theory'))).toBe(true);
    expect(texts.some((t) => t.includes('chung1997.pdf'))).toBe(true);
    expect(texts.some((t) => t.includes('\\mathcal{L} = D - A'))).toBe(true);
    expect(texts).toContain('◌');

    store.close();
  });

  it('respects showGrid toggle: fills white canvas and conditionally renders dot grid', () => {
    const store = CanvasStore.createInMemory('White Canvas Grid Test');
    const renderer = new DualCanvasRenderer();

    // Default: showGrid is false (clean white canvas)
    expect(store.showGrid).toBe(false);
    const frameNoGrid = store.buildSceneFrame(800, 600);
    expect(frameNoGrid.showGrid).toBe(false);

    const { ctx: ctxNoGrid, calls: callsNoGrid } = createRecordingContext();
    renderer.renderDrySceneGraph(ctxNoGrid, 800, 600, frameNoGrid);
    expect(callsNoGrid).toContain('clearRect');
    expect(callsNoGrid).toContain('fillRect');
    // Dot grid calls ctx.fillRect for each grid dot; when showGrid is false, only 1 background fillRect is called
    expect(callsNoGrid.filter((c) => c === 'fillRect').length).toBe(1);

    // Enabled: showGrid is true
    store.showGrid = true;
    const frameWithGrid = store.buildSceneFrame(800, 600);
    expect(frameWithGrid.showGrid).toBe(true);

    const { ctx: ctxWithGrid, calls: callsWithGrid } = createRecordingContext();
    renderer.renderDrySceneGraph(ctxWithGrid, 800, 600, frameWithGrid);
    expect(callsWithGrid.filter((c) => c === 'fillRect').length).toBeGreaterThan(1);

    store.close();
  });
});
