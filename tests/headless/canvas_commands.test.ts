import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  canvasId,
  layerId,
  nodeId,
  worldAABB,
  type CanvasId,
  type LayerId,
  type NodeId,
} from '../../src/core/canvas/types.js';
import {
  CommitStrokeCommand,
  MoveNodesCommand,
  EraseNodesCommand,
  CommandHistory,
} from '../../src/core/commands/canvas_command.js';
import { NoteFlowDatabase } from '../../src/db/client.js';
import { SpatialNodeRepository } from '../../src/db/repositories/spatial_node_repository.js';

describe('CanvasCommand System & Transactional Undo/Redo (Headless Verification)', () => {
  let db: NoteFlowDatabase;
  let repo: SpatialNodeRepository;
  let history: CommandHistory;
  let cancelledNodeBatches: NodeId[][];
  let testCanvasId: CanvasId;
  let notesLayerId: LayerId;

  beforeEach(() => {
    db = NoteFlowDatabase.createInMemory();
    repo = new SpatialNodeRepository(db);
    cancelledNodeBatches = [];
    history = new CommandHistory({
      onCancelJobsForNodes: (ids) => {
        cancelledNodeBatches.push([...ids]);
      },
    });

    testCanvasId = canvasId(crypto.randomUUID());
    notesLayerId = layerId(crypto.randomUUID());

    repo.ensureCanvasAndLayer({
      canvasId: testCanvasId,
      canvasTitle: 'Physics Mechanics',
      layerId: notesLayerId,
      layerName: 'My Notes',
      layerType: 'notes',
      zIndex: 0,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('CommitStrokeCommand executes, undoes to bit-for-bit initial state, redoes, and cancels anchored AI jobs on undo', () => {
    const strokeId = nodeId(crypto.randomUUID());
    const cmd = new CommitStrokeCommand(db, repo, {
      id: strokeId,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      bbox: worldAABB(20, 30, 120, 80),
      points: new Float32Array([20, 30, 0.5, 100, 120, 80, 0.9, 120]),
      style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
      createdAt: 1700000000000,
    });

    const initialState = repo.getAllForCanvas(testCanvasId);
    expect(initialState).toHaveLength(0);

    history.execute(cmd);
    expect(repo.getAllForCanvas(testCanvasId)).toHaveLength(1);
    expect(repo.countRTreeEntries()).toBe(1);

    // Undo -> must restore exact initial empty state and notify job cancellation
    expect(history.undo()).toBe(true);
    expect(repo.getAllForCanvas(testCanvasId)).toEqual(initialState);
    expect(repo.countRTreeEntries()).toBe(0);
    expect(cancelledNodeBatches).toEqual([[strokeId]]);

    // Redo -> restores the committed stroke
    expect(history.redo()).toBe(true);
    const afterRedo = repo.getAllForCanvas(testCanvasId);
    expect(afterRedo).toHaveLength(1);
    expect(afterRedo[0]!.id).toBe(strokeId);
    expect(repo.countRTreeEntries()).toBe(1);
  });

  it('MoveNodesCommand translates nodes and restores bit-for-bit coordinates and R-Tree bounds on undo', () => {
    const stroke1 = nodeId(crypto.randomUUID());
    const stroke2 = nodeId(crypto.randomUUID());

    history.execute(
      new CommitStrokeCommand(db, repo, {
        id: stroke1,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(10, 20, 40, 60),
        points: new Float32Array([10, 20, 0.5, 100, 40, 60, 0.8, 110]),
        style: { colorId: 'cobalt', width: 2.8, brushType: 'pen' },
        createdAt: 1700000001000,
      })
    );
    history.execute(
      new CommitStrokeCommand(db, repo, {
        id: stroke2,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(50, 20, 90, 60),
        points: new Float32Array([50, 20, 0.5, 120, 90, 60, 0.8, 130]),
        style: { colorId: 'crimson', width: 2.8, brushType: 'pen' },
        createdAt: 1700000002000,
      })
    );

    const stateBeforeMove = repo.getAllForCanvas(testCanvasId);

    const moveCmd = new MoveNodesCommand(db, repo, [stroke1, stroke2], 200, -50);
    history.execute(moveCmd);

    const movedNodes = repo.getAllForCanvas(testCanvasId);
    expect(movedNodes[0]!.bbox).toEqual([210, -30, 240, 10]);
    expect(movedNodes[1]!.bbox).toEqual([250, -30, 290, 10]);

    // Undo move -> must match stateBeforeMove bit-for-bit
    history.undo();
    const stateAfterUndo = repo.getAllForCanvas(testCanvasId);
    expect(stateAfterUndo).toEqual(stateBeforeMove);

    // R-Tree query at original location must return both strokes
    const inOriginalBox = repo.queryViewportRTree(
      testCanvasId,
      worldAABB(0, 0, 100, 100)
    );
    expect(inOriginalBox.map((n) => n.id)).toEqual([stroke1, stroke2]);
  });

  it('EraseNodesCommand deletes targeted nodes and restores exact binary points, styles, and cluster links on undo', () => {
    const clusterNodeId = nodeId(crypto.randomUUID());
    const childStrokeId = nodeId(crypto.randomUUID());

    repo.insertNode({
      id: clusterNodeId,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      nodeType: 'stroke_cluster',
      parentClusterId: null,
      bbox: worldAABB(0, 0, 100, 50),
      strokePoints: null,
      style: null,
      contentJson: { strokeCount: 1 },
      ocrText: 'E = mc^2',
      semanticTags: ['noir'],
      createdAt: 1700000005000,
      updatedAt: 1700000005000,
    });

    repo.insertNode({
      id: childStrokeId,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      nodeType: 'vector_stroke',
      parentClusterId: clusterNodeId,
      bbox: worldAABB(0, 0, 100, 50),
      strokePoints: new Float32Array([0, 0, 0.7, 10, 100, 50, 0.9, 20]),
      style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
      contentJson: null,
      ocrText: null,
      semanticTags: ['noir'],
      createdAt: 1700000005010,
      updatedAt: 1700000005010,
    });

    const snapshotBeforeErase = repo.getAllForCanvas(testCanvasId);

    const eraseCmd = new EraseNodesCommand(db, repo, [clusterNodeId, childStrokeId]);
    history.execute(eraseCmd);

    expect(repo.getAllForCanvas(testCanvasId)).toHaveLength(0);
    expect(repo.countRTreeEntries()).toBe(0);

    // Undo erase -> restores cluster and child stroke bit-for-bit
    history.undo();
    const restored = repo.getAllForCanvas(testCanvasId);
    expect(restored).toEqual(snapshotBeforeErase);
    expect(repo.countRTreeEntries()).toBe(2);
  });
});
