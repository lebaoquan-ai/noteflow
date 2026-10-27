import { describe, it, expect, vi } from 'vitest';
import {
  screenPoint,
  worldAABB,
  worldPoint,
} from '../../src/core/canvas/types.js';
import { EraseNodesCommand } from '../../src/core/commands/canvas_command.js';
import { SliceEraseCommand } from '../../src/core/commands/slice_erase_command.js';
import { NoteFlowDatabase } from '../../src/db/client.js';
import { CanvasStore } from '../../src/state/canvas_store.js';
import { HOLD_TIMEOUT_MS } from '../../src/state/gesture_fsm.js';
import { TabletPointerBridge } from '../../src/ui/scene_graph/pointer_bridge.js';
import {
  DualCanvasRenderer,
  type Canvas2DContextLike,
} from '../../src/ui/scene_graph/canvas_renderer.js';
import { ZettelRepository } from '../../src/db/repositories/zettel_repository.js';
import {
  advanceBackgroundJobPhase,
  hitTestRadialWheelSlice,
  RADIAL_WHEEL_SLICE_OFFSETS,
  synthesizeZettelForBadge,
} from '../../src/ui/tablet_app.js';

describe('Newcomer Code Review Violations A–E Regression Suite', () => {
  it('Violation A: advanceBackgroundJobPhase transitions queued -> running -> completed without ZodError', () => {
    const store = CanvasStore.createInMemory('Violation A Test');
    const notesLayer = store.getLayerByType('notes');

    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([20, 40, 0.7, 10, 140, 40, 0.7, 25]),
      style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
    });

    const initialBadges = store.jobRepo.getBadgesForCanvas(store.canvasId);
    expect(initialBadges).toHaveLength(1);
    const badgeId = initialBadges[0]!.id;
    expect(initialBadges[0]!.status).toBe('queued');

    // 350ms timer step: queued -> running
    expect(advanceBackgroundJobPhase(store, badgeId, 'running')).toBe(true);
    const runningBadge = store.jobRepo.getBadgeById(badgeId);
    expect(runningBadge?.status).toBe('running');

    // 1100ms timer step: running -> completed (validated via UpdateJobBadgeToolSchema)
    expect(advanceBackgroundJobPhase(store, badgeId, 'completed')).toBe(true);
    const completedBadge = store.jobRepo.getBadgeById(badgeId);
    expect(completedBadge?.status).toBe('completed');
    expect(completedBadge?.resultJson).toEqual({
      badgeState: 'verified',
      tooltipMessage: 'Claim & spatial cluster verified.',
    });

    store.close();
  });

  it('Violation B.1: Undoing a Violet stroke removes the stroke, cancels the badge, AND prunes the orphaned stroke_cluster', () => {
    const store = CanvasStore.createInMemory('Violation B.1 Test');
    const notesLayer = store.getLayerByType('notes');

    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([10, 20, 0.6, 5, 100, 20, 0.6, 15]),
      style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
    });

    // Before undo: 1 vector_stroke + 1 stroke_cluster + 1 badge
    expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(2);
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(1);

    // Single Undo removes both the stroke AND the empty stroke_cluster + cancels badge
    expect(store.history.undo()).toBe(true);
    expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(0);
    expect(store.nodeRepo.countRTreeEntries()).toBe(0);
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(0);

    // Redo restores both the stroke and its parent cluster
    expect(store.history.redo()).toBe(true);
    expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(2);

    store.close();
  });

  it('Violation B.2 & B.3: Incremental clustering merges proximate Word 2 into Word 1 cluster, and Circle-to-Action is undoable', () => {
    const store = CanvasStore.createInMemory('Violation B.2 Test');
    const notesLayer = store.getLayerByType('notes');

    // Write Word 1 at x=[10..50], y=100
    const word1Id = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([10, 100, 0.6, 10, 50, 100, 0.6, 20]),
      style: { colorId: 'noir', width: 2.0, brushType: 'pen' },
    });

    // 1.2s pause triggers first clustering -> creates Cluster A
    const firstClusters = store.clusterer.clusterLayerNow(
      store.canvasId,
      notesLayer.id
    );
    expect(firstClusters).toHaveLength(1);
    const clusterAId = firstClusters[0]!;

    // Write Word 2 right next to Word 1 at x=[65..110], y=100 (gap = 15px < 48px)
    const word2Id = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([65, 100, 0.6, 30, 110, 100, 0.6, 40]),
      style: { colorId: 'noir', width: 2.0, brushType: 'pen' },
    });

    // Next 1.2s pause merges Word 2 into existing Cluster A instead of creating a separate Cluster B
    const secondClusters = store.clusterer.clusterLayerNow(
      store.canvasId,
      notesLayer.id
    );
    expect(secondClusters).toEqual([clusterAId]);

    const allClusters = store.nodeRepo.getClustersInLayer(
      store.canvasId,
      notesLayer.id
    );
    expect(allClusters).toHaveLength(1);
    expect(allClusters[0]!.id).toBe(clusterAId);
    expect(allClusters[0]!.contentJson?.strokeCount).toBe(2);
    expect(store.nodeRepo.getById(word1Id)?.parentClusterId).toBe(clusterAId);
    expect(store.nodeRepo.getById(word2Id)?.parentClusterId).toBe(clusterAId);

    // Undoing Word 2 shrinks Cluster A back to Word 1
    store.history.undo();
    const shrunkCluster = store.nodeRepo.getById(clusterAId)!;
    expect(shrunkCluster.contentJson?.strokeCount).toBe(1);
    expect(shrunkCluster.bbox[2]).toBeLessThan(60);

    // Circle-to-Action executes via ClusterStrokesCommand and is undoable
    const badge = store.triggerCircleToAction(
      [
        worldPoint(0, 80),
        worldPoint(60, 80),
        worldPoint(60, 120),
        worldPoint(0, 120),
      ],
      'synthesize_zettel'
    );
    expect(badge).not.toBeNull();
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(1);

    // Undoing Circle-to-Action cancels its job and restores Word 1's prior cluster state
    store.history.undo();
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(0);
    expect(store.nodeRepo.getById(word1Id)?.parentClusterId).toBe(clusterAId);

    store.close();
  });

  it('Violation C: SliceEraseCommand ignores no-op pointermoves, cancels jobs on cut, and coalesces a continuous drag into 1 undo step', () => {
    const store = CanvasStore.createInMemory('Violation C Test');
    const notesLayer = store.getLayerByType('notes');
    const bridge = new TabletPointerBridge(store);

    // Draw a Violet horizontal stroke from (0, 100) to (300, 100)
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        0, 100, 0.7, 10,
        100, 100, 0.7, 20,
        200, 100, 0.7, 30,
        300, 100, 0.7, 40,
      ]),
      style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
    });
    expect(store.history.undoDepth).toBe(1);
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(1);

    store.selectRadialTool('stroke_eraser');

    // 1. Drag Slice Eraser across empty space (y=300) for 10 pointermove events
    bridge.handlePointerDown({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 10,
      clientY: 300,
      pressure: 0.5,
      timeStamp: 100,
    });
    for (let i = 1; i <= 10; i++) {
      bridge.handlePointerMove({
        pointerId: 1,
        pointerType: 'pen',
        clientX: 10 + i * 15,
        clientY: 300,
        pressure: 0.5,
        timeStamp: 100 + i * 8,
      });
    }
    bridge.handlePointerUp({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 160,
      clientY: 300,
      pressure: 0,
      timeStamp: 200,
    });

    // Zero no-op SliceEraseCommands were pushed!
    expect(store.history.undoDepth).toBe(1);
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(1);

    // 2. Drag Slice Eraser in one continuous gesture cutting the stroke twice (at x=50 and x=250)
    bridge.handlePointerDown({
      pointerId: 2,
      pointerType: 'pen',
      clientX: 50,
      clientY: 50,
      pressure: 0.6,
      timeStamp: 300,
    });
    // Cut #1 across x=50 (from y=50 to y=150)
    bridge.handlePointerMove({
      pointerId: 2,
      pointerType: 'pen',
      clientX: 50,
      clientY: 150,
      pressure: 0.6,
      timeStamp: 310,
    });
    // Move over to x=250, y=150
    bridge.handlePointerMove({
      pointerId: 2,
      pointerType: 'pen',
      clientX: 250,
      clientY: 150,
      pressure: 0.6,
      timeStamp: 320,
    });
    // Cut #2 across x=250 (from y=150 to y=50)
    bridge.handlePointerMove({
      pointerId: 2,
      pointerType: 'pen',
      clientX: 250,
      clientY: 50,
      pressure: 0.6,
      timeStamp: 330,
    });
    bridge.handlePointerUp({
      pointerId: 2,
      pointerType: 'pen',
      clientX: 250,
      clientY: 50,
      pressure: 0,
      timeStamp: 340,
    });

    // Badge was automatically cancelled when its stroke was sliced
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(0);
    // Both cuts in the single drag coalesced into 1 undo entry (undoDepth = 2 total)
    expect(store.history.undoDepth).toBe(2);

    // Single Undo restores the original unbroken 4-point stroke!
    store.history.undo();
    const restoredStrokes = store.nodeRepo
      .getAllForCanvas(store.canvasId)
      .filter((n) => n.nodeType === 'vector_stroke');
    expect(restoredStrokes).toHaveLength(1);
    expect(restoredStrokes[0]!.strokePoints?.length).toBe(16);

    store.close();
  });

  it('Violation D: BrowserSqlEngine atomically rolls back failed transactions and throws on unrecognized SQL', () => {
    const browserDb = NoteFlowDatabase.createBrowserInMemory();
    const store = new CanvasStore(browserDb, 'Browser Rollback Test');
    const notesLayer = store.getLayerByType('notes');

    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([10, 10, 0.5, 1, 40, 40, 0.5, 2]),
    });
    expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(1);

    // Simulate a transaction that inserts a node and then throws mid-transaction
    expect(() => {
      browserDb.transaction(() => {
        store.nodeRepo.deleteByIds(
          store.nodeRepo.getAllForCanvas(store.canvasId).map((n) => n.id)
        );
        expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(0);
        throw new Error('Simulated mid-transaction failure');
      });
    }).toThrow('Simulated mid-transaction failure');

    // Rollback restored both spatial_nodes and R-Tree spatial index!
    expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(1);
    expect(store.nodeRepo.countRTreeEntries()).toBe(1);

    // Unrecognized SQL fails fast instead of silently returning []
    expect(() => {
      browserDb.raw.prepare('SELECT * FROM non_existent_table').all();
    }).toThrow(/unsupported all\(\) SQL statement/);

    store.close();
  });

  it('Violation E: R-Tree orders by layer z_index ASC, locked layers block drawing, and DualCanvasRenderer applies layer opacity', () => {
    for (const db of [
      NoteFlowDatabase.createInMemory(),
      NoteFlowDatabase.createBrowserInMemory(),
    ]) {
      const store = new CanvasStore(db, 'Layer Ordering & Lock Test');
      const notesLayer = store.getLayerByType('notes'); // zIndex = 0
      const mathLayer = store.getLayerByType('math_formal'); // zIndex = 3

      // Insert into zIndex=3 FIRST, then zIndex=0 SECOND
      const mathStrokeId = store.commitStroke({
        layerId: mathLayer.id,
        points: new Float32Array([20, 20, 0.5, 1, 60, 60, 0.5, 2]),
      });
      const notesStrokeId = store.commitStroke({
        layerId: notesLayer.id,
        points: new Float32Array([20, 20, 0.5, 3, 60, 60, 0.5, 4]),
      });

      const frame = store.buildSceneFrame(800, 600);
      const strokeOrder = frame.visibleNodes
        .filter((n) => n.nodeType === 'vector_stroke')
        .map((n) => n.id);
      // notesStrokeId (zIndex 0) must come before mathStrokeId (zIndex 3)
      expect(strokeOrder).toEqual([notesStrokeId, mathStrokeId]);

      // Locking active layer blocks commitStroke and TabletPointerBridge
      store.setActiveLayer('hints_work');
      store.setLayerLocked('hints_work', true);
      expect(() =>
        store.commitStroke({
          layerId: store.activeLayer.id,
          points: new Float32Array([0, 0, 0.5, 1, 10, 10, 0.5, 2]),
        })
      ).toThrow(/locked layer/);

      // Layer opacity is applied during DualCanvasRenderer.renderDrySceneGraph
      store.setLayerOpacity('notes', 0.35);
      const opacityFrame = store.buildSceneFrame(800, 600);
      const recordedAlphas: number[] = [];
      const mockCtx: Canvas2DContextLike = {
        save() {},
        restore() {},
        clearRect() {},
        fillRect() {},
        strokeRect() {},
        translate() {},
        scale() {},
        rotate() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        arc() {},
        fill() {},
        stroke() {
          recordedAlphas.push(this.globalAlpha);
        },
        setLineDash() {},
        fillText() {},
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        lineCap: 'round',
        lineJoin: 'round',
        globalAlpha: 1,
        font: '',
      };

      const renderer = new DualCanvasRenderer();
      renderer.renderDrySceneGraph(mockCtx, 800, 600, opacityFrame);
      expect(recordedAlphas.some((a) => Math.abs(a - 0.35) < 1e-6)).toBe(true);

      store.close();
    }
  });

  it('Phase 4A.1: BrowserSqlEngine SpatialGridIndex returns giant nodes (>256 cells) on interior viewport queries and SliceEraseCommand skips transactions on empty space', () => {
    const db = NoteFlowDatabase.createBrowserInMemory();
    const store = new CanvasStore(db, 'Giant Node & Fast Slice Test');
    const notesLayer = store.getLayerByType('notes');

    // Commit a giant diagonal stroke spanning 6000x6000 world units (>24x24 = 576 grid cells > 256)
    const giantId = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([0, 0, 0.5, 1, 6000, 6000, 0.5, 2]),
    });

    // Query an interior 500x500 viewport far from the (0,0) and (6000,6000) corners
    const interiorHits = store.nodeRepo.queryViewportRTree(
      store.canvasId,
      worldAABB(2200, 2200, 2700, 2700)
    );
    expect(interiorHits.map((n) => n.id)).toContain(giantId);

    // SliceEraseCommand over empty space (-500, -500) must not open a DB transaction
    const txSpy = vi.spyOn(db, 'transaction');
    const emptySlice = new SliceEraseCommand(
      db,
      store.nodeRepo,
      store.canvasId,
      worldPoint(-500, -500),
      worldPoint(-450, -450),
      8,
      1
    );
    emptySlice.execute();
    expect(emptySlice.didMutate).toBe(false);
    expect(txSpy).not.toHaveBeenCalled();
    txSpy.mockRestore();

    store.close();
  });

  it('Phase 4A.2: Merging into an existing cluster prevents duplicate stacked badges and undoing a bridging stroke splits disconnected clusters back apart', () => {
    const store = CanvasStore.createInMemory('Bridged Cluster & Badge Dedup Test');
    const notesLayer = store.getLayerByType('notes');

    // Word 1 at x = [10, 40]
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([10, 50, 0.6, 1, 40, 50, 0.6, 2]),
      style: { colorId: 'violet', width: 5.0, brushType: 'highlighter' },
    });

    // Merging a second proximate Violet stroke [45, 75] must NOT create a 2nd stacked badge on the same cluster
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([45, 50, 0.6, 3, 75, 50, 0.6, 4]),
      style: { colorId: 'violet', width: 5.0, brushType: 'highlighter' },
    });

    const badgesAfterSecondViolet = store.jobRepo.getBadgesForCanvas(store.canvasId);
    expect(badgesAfterSecondViolet).toHaveLength(1);

    // Far-away Word 2 at x = [160, 190] (gap = 160 - 75 = 85px > 48px threshold -> separate Cluster B)
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([160, 50, 0.6, 5, 190, 50, 0.6, 6]),
      style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
    });
    store.clusterer.clusterLayerNow(store.canvasId, notesLayer.id);

    expect(
      store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)
    ).toHaveLength(2);

    // Now draw a bridging stroke at x = [95, 135] (within 48px of both [10,75] and [160,190])
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([95, 50, 0.6, 7, 135, 50, 0.6, 8]),
      style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
    });
    store.clusterer.clusterLayerNow(store.canvasId, notesLayer.id);

    // Bridged into 1 unified cluster
    expect(
      store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)
    ).toHaveLength(1);

    // Undo the bridging stroke: the remaining strokes [10,75] and [160,190] are 85px apart
    // and must split back into 2 separate clusters!
    expect(store.history.undo()).toBe(true);
    const clustersAfterUndo = store.nodeRepo.getClustersInLayer(
      store.canvasId,
      notesLayer.id
    );
    expect(clustersAfterUndo).toHaveLength(2);

    store.close();
  });

  it('Phase 4A.3 & 4B: Teaching Mode hides AI badges, hitTestBadgeAtScreenPoint locates visible badges, and TabletPointerBridge exposes holdAnchor on TOUCH_HOLD_MODIFIER', () => {
    vi.useFakeTimers();
    try {
      const store = CanvasStore.createInMemory('Teaching Mode Badge & Hold Anchor Test');
      const notesLayer = store.getLayerByType('notes');

      // Commit a Violet stroke at (100, 120) -> (200, 140)
      store.commitStroke({
        layerId: notesLayer.id,
        points: new Float32Array([100, 120, 0.7, 1, 200, 140, 0.7, 2]),
        style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
      });

      const frameNormal = store.buildSceneFrame(800, 600);
      expect(frameNormal.badges).toHaveLength(1);
      const badge = frameNormal.badges[0]!;

      // Hit-testing near the rendered badge center (screenX + 8, screenY - 8) returns the badge
      const hit = store.hitTestBadgeAtScreenPoint(
        screenPoint(badge.screenX + 8, badge.screenY - 8),
        800,
        600
      );
      expect(hit?.id).toBe(badge.id);

      // Enabling Teaching Mode hides ai_feedback and suppresses AI badges from the scene frame
      store.setTeachingMode(true);
      const frameTeaching = store.buildSceneFrame(800, 600);
      expect(frameTeaching.badges).toHaveLength(0);
      expect(
        store.hitTestBadgeAtScreenPoint(
          screenPoint(badge.screenX + 8, badge.screenY - 8),
          800,
          600
        )
      ).toBeNull();

      store.setTeachingMode(false);
      expect(store.buildSceneFrame(800, 600).badges).toHaveLength(1);

      // TabletPointerBridge records holdAnchor when 1-finger stationary hold reaches HOLD_TIMEOUT_MS
      const observedStates: Array<{ state: string; anchor: { x: number; y: number } | null }> = [];
      const bridge = new TabletPointerBridge(store, {
        onStateChange: (state, holdAnchor) => {
          observedStates.push({ state, anchor: holdAnchor });
        },
      });

      bridge.handlePointerDown({
        pointerId: 11,
        pointerType: 'touch',
        clientX: 340,
        clientY: 260,
        pressure: 0.5,
        timeStamp: 100,
      });
      expect(bridge.gestureState).toBe('TOUCH_1_PENDING');
      expect(bridge.holdAnchor).toBeNull();

      vi.advanceTimersByTime(HOLD_TIMEOUT_MS + 10);
      expect(bridge.gestureState).toBe('TOUCH_HOLD_MODIFIER');
      expect(bridge.holdAnchor).toEqual(screenPoint(340, 260));
      expect(observedStates.at(-1)).toEqual({
        state: 'TOUCH_HOLD_MODIFIER',
        anchor: screenPoint(340, 260),
      });

      bridge.handlePointerUp({
        pointerId: 11,
        pointerType: 'touch',
        clientX: 340,
        clientY: 260,
        pressure: 0,
        timeStamp: 500,
      });
      expect(bridge.gestureState).toBe('IDLE');
      expect(bridge.holdAnchor).toBeNull();

      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Phase 4C.1: Undoing EraseNodesCommand or SliceEraseCommand after splitting a bridged cluster deletes split clusters and restores sibling parentClusterId', () => {
    const store = CanvasStore.createInMemory('Phase 4C.1 Split Cluster Undo Test');
    const notesLayer = store.getLayerByType('notes');

    // Word 1 at x = [10, 40], Word 2 at x = [160, 190], bridged by x = [60, 140]
    const s1 = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([10, 50, 0.6, 1, 40, 50, 0.6, 2]),
    });
    const s2 = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([160, 50, 0.6, 3, 190, 50, 0.6, 4]),
    });
    const bridgeId = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([60, 50, 0.6, 5, 140, 50, 0.6, 6]),
    });
    store.clusterer.clusterLayerNow(store.canvasId, notesLayer.id);

    const initialClusters = store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id);
    expect(initialClusters).toHaveLength(1);
    const originalClusterId = initialClusters[0]!.id;

    // 1. EraseNodesCommand on bridgeId splits the cluster into 2 clusters
    store.history.execute(new EraseNodesCommand(store.db, store.nodeRepo, [bridgeId]));
    expect(store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)).toHaveLength(2);

    // Undoing EraseNodesCommand must delete the split cluster and restore 1 unified cluster!
    expect(store.history.undo()).toBe(true);
    const clustersAfterEraseUndo = store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id);
    expect(clustersAfterEraseUndo).toHaveLength(1);
    expect(clustersAfterEraseUndo[0]!.id).toBe(originalClusterId);
    expect(store.nodeRepo.getById(s1)?.parentClusterId).toBe(originalClusterId);
    expect(store.nodeRepo.getById(s2)?.parentClusterId).toBe(originalClusterId);

    // 2. SliceEraseCommand cutting the middle of bridgeId (a 2-point stroke -> deleted completely) splits into 2 clusters
    const sliceCmd = new SliceEraseCommand(
      store.db,
      store.nodeRepo,
      store.canvasId,
      worldPoint(100, 30),
      worldPoint(100, 70),
      10,
      1
    );
    store.history.execute(sliceCmd);
    expect(sliceCmd.didMutate).toBe(true);
    expect(store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)).toHaveLength(2);

    // Undoing SliceEraseCommand must delete the split cluster and restore 1 unified cluster!
    expect(store.history.undo()).toBe(true);
    const clustersAfterSliceUndo = store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id);
    expect(clustersAfterSliceUndo).toHaveLength(1);
    expect(clustersAfterSliceUndo[0]!.id).toBe(originalClusterId);
    expect(store.nodeRepo.getById(s1)?.parentClusterId).toBe(originalClusterId);
    expect(store.nodeRepo.getById(s2)?.parentClusterId).toBe(originalClusterId);

    store.close();
  });

  it('Phase 4C.2: Anisotropic proximity symmetry (gapX < 48, gapY < 24) and child-stroke AABB check prevent L-shaped cluster inflation', () => {
    const store = CanvasStore.createInMemory('Phase 4C.2 Proximity & L-Cluster Test');
    const notesLayer = store.getLayerByType('notes');

    // Line 1 at y = 50, Line 2 at y = 88 (vertical gap = 38px - stroke pad > 24px threshold, but < 48px)
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([20, 50, 0.5, 1, 80, 50, 0.5, 2]),
      style: { colorId: 'noir', width: 2.0, brushType: 'pen' },
    });
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([20, 88, 0.5, 3, 80, 88, 0.5, 4]),
      style: { colorId: 'noir', width: 2.0, brushType: 'pen' },
    });
    store.clusterer.clusterLayerNow(store.canvasId, notesLayer.id);
    expect(store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)).toHaveLength(2);

    // Temporarily bridge Line 1 and Line 2 with a vertical stroke at x = 50, y = [50, 88]
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([50, 50, 0.5, 5, 50, 88, 0.5, 6]),
      style: { colorId: 'noir', width: 2.0, brushType: 'pen' },
    });
    store.clusterer.clusterLayerNow(store.canvasId, notesLayer.id);
    expect(store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)).toHaveLength(1);

    // Undo the vertical bridge: because dy = ~36px >= 24px, Line 1 and Line 2 must split back into 2 clusters!
    store.history.undo();
    expect(store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)).toHaveLength(2);

    // L-shaped cluster test: horizontal bar [500, 100]->[700, 100] + vertical bar [500, 100]->[500, 300]
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([500, 100, 0.5, 7, 700, 100, 0.5, 8]),
      style: { colorId: 'noir', width: 2.0, brushType: 'pen' },
    });
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([500, 100, 0.5, 9, 500, 300, 0.5, 10]),
      style: { colorId: 'noir', width: 2.0, brushType: 'pen' },
    });
    store.clusterer.clusterLayerNow(store.canvasId, notesLayer.id);
    expect(store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)).toHaveLength(3);

    // Now write a stroke in the empty bottom-right corner of the L-cluster's AABB: [680, 280]->[700, 280]
    // It is inside the L-cluster's coarse AABB [500,100,700,300], but >170px away from both bars!
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([680, 280, 0.5, 11, 700, 280, 0.5, 12]),
      style: { colorId: 'noir', width: 2.0, brushType: 'pen' },
    });
    store.clusterer.clusterLayerNow(store.canvasId, notesLayer.id);
    // Must form a separate 4th cluster, NOT merge into the L-shaped cluster!
    expect(store.nodeRepo.getClustersInLayer(store.canvasId, notesLayer.id)).toHaveLength(4);

    store.close();
  });

  it('Phase 4C.3: Redoing an undone Violet stroke restores its AI verification badge and buildSceneFrame executes zero N+1 getById queries', () => {
    const store = CanvasStore.createInMemory('Phase 4C.3 Redo Violet Badge & Zero N+1 Test');
    const notesLayer = store.getLayerByType('notes');

    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([40, 60, 0.7, 1, 140, 60, 0.7, 2]),
      style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
    });
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(1);

    // Undo deletes the stroke and cancels the badge
    expect(store.history.undo()).toBe(true);
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(0);

    // Redo restores the stroke AND re-enqueues the AI verification badge!
    expect(store.history.redo()).toBe(true);
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(1);

    // buildSceneFrame must filter badges by anchorLayerId from the JOIN without calling nodeRepo.getById
    const getByIdSpy = vi.spyOn(store.nodeRepo, 'getById');
    const frame = store.buildSceneFrame(800, 600);
    expect(frame.badges).toHaveLength(1);
    expect(getByIdSpy).not.toHaveBeenCalled();
    getByIdSpy.mockRestore();

    store.close();
  });

  it('Phase 4C.4: hitTestRadialWheelSlice resolves all 6 radial slots and synthesizeZettelForBadge prevents duplicate Zettel synthesis on the same badge', () => {
    const anchor = screenPoint(300, 300);

    // Center deadzone (< 24px) returns null (used for sticky wheel summon on stationary release)
    expect(hitTestRadialWheelSlice(anchor, screenPoint(305, 295))).toBeNull();
    // Outside wheel radius (> 115px) returns null
    expect(hitTestRadialWheelSlice(anchor, screenPoint(450, 300))).toBeNull();

    // Every radial slice offset resolves to its exact tool slot
    for (const slice of RADIAL_WHEEL_SLICE_OFFSETS) {
      const cursor = screenPoint(anchor.x + slice.dx, anchor.y + slice.dy);
      expect(hitTestRadialWheelSlice(anchor, cursor)).toBe(slice.tool);
    }

    // Badge Zettel synthesis dedup test
    const store = CanvasStore.createInMemory('Phase 4C.4 Badge Zettel Dedup Test');
    const zettelRepo = new ZettelRepository(store.db);
    const notesLayer = store.getLayerByType('notes');

    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([50, 80, 0.7, 1, 150, 80, 0.7, 2]),
      style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
    });
    const badge = store.jobRepo.getBadgesForCanvas(store.canvasId)[0]!;
    advanceBackgroundJobPhase(store, badge.id, 'completed');

    // First synthesis creates 1 zettel_card and records linkedZettelId on the badge
    const firstCardId = synthesizeZettelForBadge(store, zettelRepo, badge.id);
    expect(firstCardId).not.toBeNull();
    expect(
      store.nodeRepo
        .getAllForCanvas(store.canvasId)
        .filter((n) => n.nodeType === 'zettel_card')
    ).toHaveLength(1);

    // Second synthesis on the same badge is a no-op (prevents duplicate overlapping cards)
    const secondCardId = synthesizeZettelForBadge(store, zettelRepo, badge.id);
    expect(secondCardId).toBeNull();
    expect(
      store.nodeRepo
        .getAllForCanvas(store.canvasId)
        .filter((n) => n.nodeType === 'zettel_card')
    ).toHaveLength(1);

    // Undoing the Zettel synthesis removes the zettel_card and allows re-synthesizing from the badge
    expect(store.history.undo()).toBe(true);
    expect(
      store.nodeRepo
        .getAllForCanvas(store.canvasId)
        .filter((n) => n.nodeType === 'zettel_card')
    ).toHaveLength(0);
    const reSynthesizedCardId = synthesizeZettelForBadge(store, zettelRepo, badge.id);
    expect(reSynthesizedCardId).not.toBeNull();
    expect(
      store.nodeRepo
        .getAllForCanvas(store.canvasId)
        .filter((n) => n.nodeType === 'zettel_card')
    ).toHaveLength(1);

    store.close();
  });

  it('Phase 4D: SliceEraseCommand and selectNodesInLasso ignore hidden/locked layers, and redoing triggerCircleToAction restores its AI badge', () => {
    const store = CanvasStore.createInMemory('Phase 4D Layer Isolation & Circle-to-Action Redo Test');
    const notesLayer = store.getLayerByType('notes');
    const hintsLayer = store.getLayerByType('hints_work');
    const mathLayer = store.getLayerByType('math_formal');

    const notesStrokeId = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([10, 50, 0.6, 1, 100, 50, 0.6, 2]),
    });
    const hintsStrokeId = store.commitStroke({
      layerId: hintsLayer.id,
      points: new Float32Array([10, 55, 0.6, 3, 100, 55, 0.6, 4]),
    });
    const mathStrokeId = store.commitStroke({
      layerId: mathLayer.id,
      points: new Float32Array([10, 60, 0.6, 5, 100, 60, 0.6, 6]),
    });

    // Hide hints_work via Teaching Mode and lock math_formal
    store.setTeachingMode(true);
    store.setLayerLocked('math_formal', true);

    const lassoPolygon = [
      worldPoint(0, 0),
      worldPoint(120, 0),
      worldPoint(120, 100),
      worldPoint(0, 100),
    ];

    // 1. selectNodesInLasso must only select strokes on visible, unlocked layers (notesLayer)
    const lassoed = store.selectNodesInLasso(lassoPolygon);
    expect(lassoed.map((n) => n.id)).toEqual([notesStrokeId]);

    // 2. Stylus Slice Eraser drag across (50, 20) -> (50, 80) must slice notesStrokeId
    // while leaving hintsStrokeId (hidden) and mathStrokeId (locked) untouched
    store.selectRadialTool('stroke_eraser');
    const bridge = new TabletPointerBridge(store);
    bridge.handlePointerDown({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 50,
      clientY: 20,
      pressure: 0.7,
      timeStamp: 10,
    });
    bridge.handlePointerMove({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 50,
      clientY: 80,
      pressure: 0.7,
      timeStamp: 20,
    });
    bridge.handlePointerUp({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 50,
      clientY: 80,
      pressure: 0,
      timeStamp: 30,
    });

    expect(store.nodeRepo.getById(notesStrokeId)).toBeNull();
    expect(store.nodeRepo.getById(hintsStrokeId)).not.toBeNull();
    expect(store.nodeRepo.getById(mathStrokeId)).not.toBeNull();

    // Undo the slice so notesStrokeId is restored
    expect(store.history.undo()).toBe(true);
    expect(store.nodeRepo.getById(notesStrokeId)).not.toBeNull();

    // 3. Circle-to-Action creates a manual cluster and enqueues a synthesize_zettel badge
    const c2aBadge = store.triggerCircleToAction(lassoPolygon, 'synthesize_zettel');
    expect(c2aBadge).not.toBeNull();
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(1);
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)[0]!.jobType).toBe(
      'synthesize_zettel'
    );

    // Undo removes the manual cluster and cancels its badge
    expect(store.history.undo()).toBe(true);
    expect(store.jobRepo.getBadgesForCanvas(store.canvasId)).toHaveLength(0);

    // Redo restores the manual cluster AND re-enqueues its synthesize_zettel badge
    expect(store.history.redo()).toBe(true);
    const redoneBadges = store.jobRepo.getBadgesForCanvas(store.canvasId);
    expect(redoneBadges).toHaveLength(1);
    expect(redoneBadges[0]!.jobType).toBe('synthesize_zettel');

    store.close();
  });
});
