import { describe, it, expect, vi } from 'vitest';
import { worldAABB } from '../../src/core/canvas/types.js';
import { NoteFlowDatabase } from '../../src/db/client.js';
import { BrowserSqlEngine } from '../../src/db/browser_sql_engine.js';
import {
  IndexedDbVaultStorage,
  InMemoryVaultBackend,
} from '../../src/db/indexeddb_persistence.js';
import { CanvasStore } from '../../src/state/canvas_store.js';
import { HOLD_TIMEOUT_MS } from '../../src/state/gesture_fsm.js';
import { TabletPointerBridge } from '../../src/ui/scene_graph/pointer_bridge.js';
import { ZettelRepository } from '../../src/db/repositories/zettel_repository.js';
import { CreateZettelCardCommand } from '../../src/core/commands/zettel_commands.js';

describe('Phase 5: Galaxy Tab Wacom S-Pen Resilience, 2-Finger Rotation Lock & Snapshot Persistence', () => {
  it('Phase 5.1: Wacom EMR 400ms pointercancel grace window preserves TOUCH_HOLD_PEN_LASSOING when S-Pen hovers', () => {
    vi.useFakeTimers();
    try {
      const store = CanvasStore.createInMemory('Galaxy Tab Wacom Hover Test');
      const notesLayer = store.getLayerByType('notes');

      // Seed a stroke inside (100, 100) -> (150, 100)
      const targetId = store.commitStroke({
        layerId: notesLayer.id,
        points: new Float32Array([100, 100, 0.6, 10, 150, 100, 0.6, 20]),
      });

      let lassoSelectedIds: readonly string[] = [];
      const bridge = new TabletPointerBridge(store, {
        onLassoSelection: (ids) => {
          lassoSelectedIds = ids;
        },
      });

      // 1. Left thumb touches down and holds for 220ms -> TOUCH_HOLD_MODIFIER
      bridge.handlePointerDown({
        pointerId: 1,
        pointerType: 'touch',
        clientX: 40,
        clientY: 400,
        pressure: 0.5,
        timeStamp: 100,
      });
      vi.advanceTimersByTime(HOLD_TIMEOUT_MS + 10);
      expect(bridge.gestureState).toBe('TOUCH_HOLD_MODIFIER');

      // 2. S-Pen enters 15mm Wacom hover zone at t=400ms -> Android fires pointercancel on touch!
      bridge.handlePointerCancel({
        pointerId: 1,
        pointerType: 'touch',
        clientX: 40,
        clientY: 400,
        pressure: 0,
        timeStamp: 400,
      });

      // 3. 120ms later (t=520ms, within 400ms grace window), S-Pen tip touches glass
      bridge.handlePointerDown({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 80,
        clientY: 80,
        pressure: 0.6,
        timeStamp: 520,
      });

      expect(bridge.gestureState).toBe('TOUCH_HOLD_PEN_LASSOING');

      // Draw lasso loop around (100,100)-(150,100)
      bridge.handlePointerMove({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 180,
        clientY: 80,
        pressure: 0.6,
        timeStamp: 540,
      });
      bridge.handlePointerMove({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 180,
        clientY: 140,
        pressure: 0.6,
        timeStamp: 560,
      });
      bridge.handlePointerMove({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 80,
        clientY: 140,
        pressure: 0.6,
        timeStamp: 580,
      });
      bridge.handlePointerUp({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 80,
        clientY: 80,
        pressure: 0,
        timeStamp: 600,
      });

      expect(lassoSelectedIds).toContain(targetId);
      expect(bridge.gestureState).toBe('IDLE');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Phase 5.2: Releasing or cancelling thumb mid-lasso (TOUCH_HOLD_PEN_LASSOING) does not drop the lasso stroke', () => {
    vi.useFakeTimers();
    try {
      const store = CanvasStore.createInMemory('Mid-Lasso Touch Release Test');
      const notesLayer = store.getLayerByType('notes');

      const targetId = store.commitStroke({
        layerId: notesLayer.id,
        points: new Float32Array([100, 100, 0.6, 10, 140, 100, 0.6, 20]),
      });

      let lassoSelectedIds: readonly string[] = [];
      const bridge = new TabletPointerBridge(store, {
        onLassoSelection: (ids) => {
          lassoSelectedIds = ids;
        },
      });

      // 1. Thumb hold -> TOUCH_HOLD_MODIFIER
      bridge.handlePointerDown({
        pointerId: 1,
        pointerType: 'touch',
        clientX: 30,
        clientY: 300,
        pressure: 0.5,
        timeStamp: 10,
      });
      vi.advanceTimersByTime(HOLD_TIMEOUT_MS + 10);
      expect(bridge.gestureState).toBe('TOUCH_HOLD_MODIFIER');

      // 2. Pen down -> TOUCH_HOLD_PEN_LASSOING
      bridge.handlePointerDown({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 70,
        clientY: 70,
        pressure: 0.6,
        timeStamp: 300,
      });
      expect(bridge.gestureState).toBe('TOUCH_HOLD_PEN_LASSOING');

      // 3. Move pen halfway, then user lifts thumb (TOUCH_END) while pen is still down!
      bridge.handlePointerMove({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 180,
        clientY: 70,
        pressure: 0.6,
        timeStamp: 320,
      });
      bridge.handlePointerUp({
        pointerId: 1,
        pointerType: 'touch',
        clientX: 30,
        clientY: 300,
        pressure: 0,
        timeStamp: 330,
      });

      // Must remain in TOUCH_HOLD_PEN_LASSOING until PEN_UP
      expect(bridge.gestureState).toBe('TOUCH_HOLD_PEN_LASSOING');

      // 4. Finish loop and lift pen
      bridge.handlePointerMove({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 180,
        clientY: 140,
        pressure: 0.6,
        timeStamp: 350,
      });
      bridge.handlePointerMove({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 70,
        clientY: 140,
        pressure: 0.6,
        timeStamp: 370,
      });
      bridge.handlePointerUp({
        pointerId: 2,
        pointerType: 'pen',
        clientX: 70,
        clientY: 70,
        pressure: 0,
        timeStamp: 390,
      });

      expect(lassoSelectedIds).toContain(targetId);
      expect(bridge.gestureState).toBe('IDLE');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Phase 5.3: 2-finger pinch rotation respects store.rotationLocked (locked by default, rotates when unlocked)', () => {
    const store = CanvasStore.createInMemory('Rotation Lock Test');
    const bridge = new TabletPointerBridge(store);

    expect(store.rotationLocked).toBe(true);

    // Finger 1 at (100, 100), Finger 2 at (200, 100) -> initial angle = 0 rad
    bridge.handlePointerDown({
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
      pressure: 0.5,
      timeStamp: 10,
    });
    bridge.handlePointerDown({
      pointerId: 2,
      pointerType: 'touch',
      clientX: 200,
      clientY: 100,
      pressure: 0.5,
      timeStamp: 15,
    });
    expect(bridge.gestureState).toBe('TOUCH_PINCH_ZOOMING');

    // Rotate Finger 2 to (100, 200) -> +90 degrees (+PI/2 rad) while rotationLocked === true
    bridge.handlePointerMove({
      pointerId: 2,
      pointerType: 'touch',
      clientX: 100,
      clientY: 200,
      pressure: 0.5,
      timeStamp: 40,
    });
    expect(store.camera.rotation).toBe(0);

    // Unlock rotation and rotate Finger 2 back toward (200, 200) -> angle = +PI/4 (-PI/4 delta)
    store.setRotationLocked(false);
    expect(store.rotationLocked).toBe(false);

    bridge.handlePointerMove({
      pointerId: 2,
      pointerType: 'touch',
      clientX: 200,
      clientY: 200,
      pressure: 0.5,
      timeStamp: 60,
    });
    expect(store.camera.rotation).not.toBe(0);
  });

  it('Phase 5.4: BrowserSqlEngine exportSnapshot() and importSnapshot() round-trip all strokes, clusters, badges, and Zettels', () => {
    const engine1 = new BrowserSqlEngine();
    const db1 = new NoteFlowDatabase(engine1);
    const store1 = CanvasStore.fromDatabase(db1, 'Persisted Galaxy Tab Canvas');
    const zettelRepo1 = new ZettelRepository(db1);
    const notesLayer1 = store1.getLayerByType('notes');

    // Commit a regular stroke + a Violet stroke
    const stroke1Id = store1.commitStroke({
      layerId: notesLayer1.id,
      points: new Float32Array([50, 60, 0.7, 10, 120, 60, 0.8, 25]),
    });
    store1.commitStroke({
      layerId: notesLayer1.id,
      points: new Float32Array([55, 65, 0.7, 30, 125, 65, 0.7, 45]),
      style: { colorId: 'violet', width: 5.2, brushType: 'highlighter' },
    });

    // Force immediate Tier-0 clustering
    store1.clusterer.clusterLayerNow(store1.canvasId, notesLayer1.id);
    const clusters1 = store1.nodeRepo.getClustersInLayer(
      store1.canvasId,
      notesLayer1.id
    );
    expect(clusters1.length).toBeGreaterThanOrEqual(1);

    // Create a Zettel card
    const createZettel = new CreateZettelCardCommand(
      db1,
      store1.nodeRepo,
      zettelRepo1,
      {
        canvasId: store1.canvasId,
        layerId: notesLayer1.id,
        toolInput: {
          anchorClusterId: clusters1[0]!.id,
          title: 'Persisted Atomic Concept',
          summaryMarkdown: 'Survives APK restarts via IndexedDB snapshot.',
          latexBlocks: [],
          verificationState: 'verified',
          worldPosition: { x: 300, y: 200 },
        },
        embedding: null,
      }
    );
    store1.history.execute(createZettel);

    // Pan camera to verify camera state also persists
    store1.panCamera(120, -45);

    // Export snapshot and import into a brand-new BrowserSqlEngine
    const snapshot = engine1.exportSnapshot();
    const engine2 = new BrowserSqlEngine();
    engine2.importSnapshot(snapshot);

    const db2 = new NoteFlowDatabase(engine2);
    const store2 = CanvasStore.fromDatabase(db2, 'Fallback Title If Empty');
    const zettelRepo2 = new ZettelRepository(db2);

    expect(store2.canvasId).toBe(store1.canvasId);
    expect(store2.camera.panX).toBe(120);
    expect(store2.camera.panY).toBe(-45);
    const restoredStroke = store2.nodeRepo.getById(stroke1Id);
    expect(restoredStroke).not.toBeNull();
    expect(Array.from(restoredStroke!.strokePoints!)).toEqual(
      Array.from(new Float32Array([50, 60, 0.7, 10, 120, 60, 0.8, 25]))
    );

    const badges2 = store2.jobRepo.getBadgesForCanvas(store2.canvasId);
    expect(badges2.length).toBeGreaterThanOrEqual(1);

    const restoredCluster = store2.nodeRepo.getById(clusters1[0]!.id);
    expect(restoredCluster).not.toBeNull();
    const zettels2 = zettelRepo2.getAllZettels();
    expect(zettels2).toHaveLength(1);
    expect(zettels2[0]!.title).toBe('Persisted Atomic Concept');

    // Viewport spatial grid query must also return the restored nodes
    const viewportNodes = store2.nodeRepo.queryViewportRTree(
      store2.canvasId,
      worldAABB(0, 0, 600, 600)
    );
    expect(viewportNodes.some((n) => n.id === stroke1Id)).toBe(true);
  });

  it('Phase 5.5: IndexedDbVaultStorage debounced write-behind persists mutations and clearVault() wipes storage', async () => {
    vi.useFakeTimers();
    try {
      const backend = new InMemoryVaultBackend();
      const vault = new IndexedDbVaultStorage({ backend, debounceMs: 250 });

      const engine1 = new BrowserSqlEngine();
      vault.bindEngine(engine1);
      const db1 = new NoteFlowDatabase(engine1);
      const store1 = CanvasStore.fromDatabase(db1, 'Debounced Vault Test');
      const notesLayer = store1.getLayerByType('notes');

      const strokeId = store1.commitStroke({
        layerId: notesLayer.id,
        points: new Float32Array([10, 20, 0.5, 1, 40, 20, 0.5, 5]),
      });

      // Advance debounce timer (250ms) and flush microtasks
      await vi.advanceTimersByTimeAsync(260);
      expect(vault.saveCount).toBeGreaterThanOrEqual(1);

      const engine2 = new BrowserSqlEngine();
      const hydrated = await vault.hydrateEngine(engine2);
      expect(hydrated).toBe(true);

      const db2 = new NoteFlowDatabase(engine2);
      const store2 = CanvasStore.fromDatabase(db2);
      expect(store2.nodeRepo.getById(strokeId)).not.toBeNull();

      // Clear vault and verify loadSnapshot returns null
      await vault.clearVault();
      expect(await vault.loadSnapshot()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
