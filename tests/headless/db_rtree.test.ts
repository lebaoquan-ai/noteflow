import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  canvasId,
  layerId,
  nodeId,
  jobId,
  worldAABB,
  type CanvasId,
  type LayerId,
} from '../../src/core/canvas/types.js';
import { NoteFlowDatabase } from '../../src/db/client.js';
import { SpatialNodeRepository } from '../../src/db/repositories/spatial_node_repository.js';
import { AsyncJobRepository } from '../../src/db/repositories/async_job_repository.js';

describe('SQLite Schema, Auto-Synced R-Tree Triggers & Repositories (Headless Verification)', () => {
  let db: NoteFlowDatabase;
  let nodeRepo: SpatialNodeRepository;
  let jobRepo: AsyncJobRepository;
  let testCanvasId: CanvasId;
  let notesLayerId: LayerId;

  beforeEach(() => {
    db = NoteFlowDatabase.createInMemory();
    nodeRepo = new SpatialNodeRepository(db);
    jobRepo = new AsyncJobRepository(db);

    testCanvasId = canvasId(crypto.randomUUID());
    notesLayerId = layerId(crypto.randomUUID());

    nodeRepo.ensureCanvasAndLayer({
      canvasId: testCanvasId,
      canvasTitle: 'Linear Algebra Notes',
      layerId: notesLayerId,
      layerName: 'My Notes',
      layerType: 'notes',
      zIndex: 0,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('automatically syncs R-Tree index on INSERT, UPDATE, and DELETE via SQL triggers', () => {
    const strokeA = nodeId(crypto.randomUUID());
    const strokeB = nodeId(crypto.randomUUID());

    nodeRepo.insertNode({
      id: strokeA,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      nodeType: 'vector_stroke',
      parentClusterId: null,
      bbox: worldAABB(10, 10, 50, 50),
      strokePoints: new Float32Array([10, 10, 0.5, 100, 50, 50, 0.7, 116]),
      style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
      contentJson: null,
      ocrText: null,
      semanticTags: ['noir'],
    });

    nodeRepo.insertNode({
      id: strokeB,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      nodeType: 'vector_stroke',
      parentClusterId: null,
      bbox: worldAABB(500, 500, 600, 600),
      strokePoints: new Float32Array([500, 500, 0.5, 200, 600, 600, 0.7, 216]),
      style: { colorId: 'cobalt', width: 2.8, brushType: 'pen' },
      contentJson: null,
      ocrText: null,
      semanticTags: ['cobalt'],
    });

    // 1. Viewport [0, 0, 100, 100] should only return strokeA
    const inOriginViewport = nodeRepo.queryViewportRTree(
      testCanvasId,
      worldAABB(0, 0, 100, 100)
    );
    expect(inOriginViewport.map((n) => n.id)).toEqual([strokeA]);

    // 2. Translate strokeA by (+480, +480) -> new bbox [490, 490, 530, 530]
    nodeRepo.translateBatch([strokeA], 480, 480);

    // Origin viewport should now be empty (proving sync_rtree_update fired)
    expect(
      nodeRepo.queryViewportRTree(testCanvasId, worldAABB(0, 0, 100, 100))
    ).toHaveLength(0);

    // Far viewport [450, 450, 650, 650] should now contain BOTH strokeA and strokeB
    const inFarViewport = nodeRepo.queryViewportRTree(
      testCanvasId,
      worldAABB(450, 450, 650, 650)
    );
    expect(inFarViewport.map((n) => n.id).sort()).toEqual([strokeA, strokeB].sort());

    // Verify strokeA's binary Float32Array points were also translated
    const updatedA = nodeRepo.getById(strokeA);
    expect(updatedA).not.toBeNull();
    expect(updatedA!.strokePoints![0]).toBeCloseTo(490, 4);
    expect(updatedA!.strokePoints![1]).toBeCloseTo(490, 4);
    expect(updatedA!.strokePoints![4]).toBeCloseTo(530, 4);
    expect(updatedA!.strokePoints![5]).toBeCloseTo(530, 4);

    // 3. Delete strokeA -> R-Tree entry must be removed via sync_rtree_delete
    nodeRepo.deleteByIds([strokeA]);
    const remaining = nodeRepo.queryViewportRTree(
      testCanvasId,
      worldAABB(450, 450, 650, 650)
    );
    expect(remaining.map((n) => n.id)).toEqual([strokeB]);
    expect(nodeRepo.countRTreeEntries()).toBe(1);
  });

  it('atomically translates a stroke_cluster along with its child vector_stroke nodes and updates dynamic badge coordinates', () => {
    const clusterId = nodeId(crypto.randomUUID());
    const childStrokeId = nodeId(crypto.randomUUID());
    const badgeJobId = jobId(crypto.randomUUID());

    nodeRepo.insertNode({
      id: clusterId,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      nodeType: 'stroke_cluster',
      parentClusterId: null,
      bbox: worldAABB(100, 200, 300, 260),
      strokePoints: null,
      style: null,
      contentJson: { strokeCount: 1 },
      ocrText: 'det(A) = 0',
      semanticTags: ['violet'],
    });

    nodeRepo.insertNode({
      id: childStrokeId,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      nodeType: 'vector_stroke',
      parentClusterId: clusterId,
      bbox: worldAABB(100, 200, 300, 260),
      strokePoints: new Float32Array([100, 200, 0.6, 10, 300, 260, 0.8, 25]),
      style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
      contentJson: null,
      ocrText: null,
      semanticTags: ['noir'],
    });

    jobRepo.enqueueJob({
      id: badgeJobId,
      canvasId: testCanvasId,
      anchorNodeId: clusterId,
      jobType: 'verify_claim',
    });

    // Before translation, badge top-right anchor is (max_x=300, min_y=200)
    const badgesBefore = jobRepo.getBadgesForCanvas(testCanvasId);
    expect(badgesBefore).toHaveLength(1);
    expect(badgesBefore[0]!.anchorX).toBe(300);
    expect(badgesBefore[0]!.anchorY).toBe(200);
    expect(badgesBefore[0]!.status).toBe('queued');

    // Translate only the clusterId by (+50, -30) -> both cluster and child stroke must move
    nodeRepo.translateBatch([clusterId], 50, -30);

    const badgesAfter = jobRepo.getBadgesForCanvas(testCanvasId);
    expect(badgesAfter[0]!.anchorX).toBe(350);
    expect(badgesAfter[0]!.anchorY).toBe(170);

    const movedChild = nodeRepo.getById(childStrokeId)!;
    expect(movedChild.bbox).toEqual([150, 170, 350, 230]);

    // Deleting the cluster cascades or removes the anchored badge so no zombie badge remains
    nodeRepo.deleteByIds([clusterId]);
    expect(jobRepo.getBadgesForCanvas(testCanvasId)).toHaveLength(0);
  });
});
