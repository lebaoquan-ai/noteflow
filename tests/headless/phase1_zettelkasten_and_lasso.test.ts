import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  worldPoint,
  worldAABB,
  nodeId,
} from '../../src/core/canvas/types.js';
import { CreateZettelCardToolSchema } from '../../src/ai/agent_contract.js';
import { CanvasStore } from '../../src/state/canvas_store.js';
import { ZettelRepository } from '../../src/db/repositories/zettel_repository.js';
import { CreateZettelCardCommand } from '../../src/core/commands/zettel_commands.js';

describe('Phase 1 — Spatial Zettelkasten, Freehand Lasso & Vector Similarity (Headless Verification)', () => {
  let store: CanvasStore;
  let zettelRepo: ZettelRepository;

  beforeEach(() => {
    store = CanvasStore.createInMemory('Quantum Mechanics Zettelkasten');
    zettelRepo = new ZettelRepository(store.db);
  });

  afterEach(() => {
    store.close();
  });

  it('selects strokes inside a freehand lasso polygon using R-Tree frustum culling + point-in-polygon raycasting and triggers Circle-to-Action', () => {
    const notesLayer = store.getLayerByType('notes');

    // Stroke inside the lasso [40..80, 40..80]
    const insideStrokeId = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([40, 40, 0.6, 10, 80, 80, 0.7, 20]),
      style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
    });

    // Stroke outside the lasso [300..350, 300..350]
    const outsideStrokeId = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([300, 300, 0.6, 30, 350, 350, 0.7, 40]),
      style: { colorId: 'cobalt', width: 2.8, brushType: 'pen' },
    });

    const lassoPolygon = [
      worldPoint(20, 20),
      worldPoint(120, 20),
      worldPoint(120, 120),
      worldPoint(20, 120),
    ];

    const selected = store.selectNodesInLasso(lassoPolygon);
    expect(selected.map((n) => n.id)).toEqual([insideStrokeId]);
    expect(selected.map((n) => n.id)).not.toContain(outsideStrokeId);

    // Circle-to-Action synthesizes a cluster and enqueues a 'synthesize_zettel' job
    const job = store.triggerCircleToAction(lassoPolygon, 'synthesize_zettel');
    expect(job).not.toBeNull();
    expect(job!.jobType).toBe('synthesize_zettel');
    expect(job!.status).toBe('queued');
  });

  it('creates an undoable Zettel Card from AI tool output, links Zettels bidirectionally, and ranks semantic neighbors by 768-d embedding similarity', () => {
    const notesLayer = store.getLayerByType('notes');
    const anchorClusterId = nodeId(crypto.randomUUID());

    store.nodeRepo.insertNode({
      id: anchorClusterId,
      canvasId: store.canvasId,
      layerId: notesLayer.id,
      nodeType: 'stroke_cluster',
      parentClusterId: null,
      bbox: worldAABB(100, 100, 260, 150),
      strokePoints: null,
      style: null,
      contentJson: { strokeCount: 2 },
      ocrText: '[x, p] = i\\hbar',
      semanticTags: ['noir'],
    });

    const toolCall1 = CreateZettelCardToolSchema.parse({
      anchorClusterId,
      title: 'Canonical Commutation Relation',
      summaryMarkdown: 'Fundamental postulate between position and momentum operators.',
      latexBlocks: ['[\\hat{x}, \\hat{p}] = i\\hbar'],
      verificationState: 'verified',
      worldPosition: { x: 280, y: 100 },
    });

    const emb1 = new Float32Array(768);
    emb1[0] = 0.9;
    emb1[1] = 0.1;

    const cmd1 = new CreateZettelCardCommand(
      store.db,
      store.nodeRepo,
      zettelRepo,
      {
        canvasId: store.canvasId,
        layerId: notesLayer.id,
        toolInput: toolCall1,
        embedding: emb1,
      }
    );

    store.history.execute(cmd1);

    const createdZettel1 = zettelRepo.getById(cmd1.zettelId);
    expect(createdZettel1).not.toBeNull();
    expect(createdZettel1!.title).toBe('Canonical Commutation Relation');
    expect(createdZettel1!.latexBlocks).toEqual(['[\\hat{x}, \\hat{p}] = i\\hbar']);

    // Create a second Zettel (Heisenberg Uncertainty Principle) that derives from the first
    const toolCall2 = CreateZettelCardToolSchema.parse({
      anchorClusterId,
      title: 'Heisenberg Uncertainty Principle',
      summaryMarkdown: 'Lower bound on standard deviations of position and momentum.',
      latexBlocks: ['\\sigma_x \\sigma_p \\ge \\frac{\\hbar}{2}'],
      verificationState: 'verified',
      worldPosition: { x: 280, y: 260 },
    });

    const emb2 = new Float32Array(768);
    emb2[0] = 0.85;
    emb2[1] = 0.25;

    const cmd2 = new CreateZettelCardCommand(
      store.db,
      store.nodeRepo,
      zettelRepo,
      {
        canvasId: store.canvasId,
        layerId: notesLayer.id,
        toolInput: toolCall2,
        embedding: emb2,
      }
    );
    store.history.execute(cmd2);

    // Link Zettel 2 -> Zettel 1 ('derives_from')
    const link = zettelRepo.upsertLink({
      sourceZettelId: cmd2.zettelId,
      targetZettelId: cmd1.zettelId,
      relationType: 'derives_from',
      confidence: 0.98,
    });
    expect(link.relationType).toBe('derives_from');

    const backlinksTo1 = zettelRepo.getLinksForZettel(cmd1.zettelId);
    expect(backlinksTo1).toHaveLength(1);
    expect(backlinksTo1[0]!.sourceZettelId).toBe(cmd2.zettelId);

    // Query semantic vector search with a query close to emb1
    const queryVec = new Float32Array(768);
    queryVec[0] = 1.0;
    queryVec[1] = 0.0;
    const nearest = zettelRepo.searchSimilarZettels(queryVec, 2);
    expect(nearest).toHaveLength(2);
    expect(nearest[0]!.zettel.id).toBe(cmd1.zettelId);
    expect(nearest[0]!.similarity).toBeGreaterThan(nearest[1]!.similarity);

    // Undo Zettel 2 creation -> removes Zettel 2, its spatial node, and cascades its link
    store.history.undo();
    expect(zettelRepo.getById(cmd2.zettelId)).toBeNull();
    expect(store.nodeRepo.getById(cmd2.spatialNodeId)).toBeNull();
    expect(zettelRepo.getLinksForZettel(cmd1.zettelId)).toHaveLength(0);
  });
});
