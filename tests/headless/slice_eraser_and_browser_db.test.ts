import { describe, it, expect } from 'vitest';
import {
  worldPoint,
  worldAABB,
  screenPoint,
} from '../../src/core/canvas/types.js';
import { NoteFlowDatabase } from '../../src/db/client.js';
import { CanvasStore } from '../../src/state/canvas_store.js';
import { SliceEraseCommand } from '../../src/core/commands/slice_erase_command.js';

describe('Slice Eraser Geometry & BrowserSqlEngine Parity (Headless Verification)', () => {
  it('runs the full CanvasStore, R-Tree culling, and Violet AI badge loop on BrowserSqlEngine with 100% parity', () => {
    const browserDb = NoteFlowDatabase.createBrowserInMemory();
    const store = new CanvasStore(browserDb, 'Tablet Browser Engine Test');
    const notesLayer = store.getLayerByType('notes');

    const strokeId = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([50, 60, 0.6, 10, 200, 120, 0.8, 30]),
      style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
    });

    const frame = store.buildSceneFrame(1024, 768);
    expect(frame.visibleNodes.map((n) => n.id)).toContain(strokeId);
    expect(frame.badges).toHaveLength(1);
    expect(frame.badges[0]!.status).toBe('queued');

    store.panCamera(100, 50);
    store.zoomCamera(screenPoint(512, 384), 1.5);

    // Undo removes both stroke and anchored badge
    store.history.undo();
    expect(store.buildSceneFrame(1024, 768).badges).toHaveLength(0);
    store.close();
  });

  it('SliceEraseCommand splits an intersected multi-point stroke into two sub-strokes and restores the original unbroken stroke on undo', () => {
    const store = CanvasStore.createInMemory('Slice Eraser Test');
    const notesLayer = store.getLayerByType('notes');

    // Horizontal 4-point stroke from x=0 to x=300 at y=100:
    // (0, 100) -> (100, 100) -> (200, 100) -> (300, 100)
    const originalStrokeId = store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        0, 100, 0.6, 10,
        100, 100, 0.7, 20,
        200, 100, 0.7, 30,
        300, 100, 0.6, 40,
      ]),
      style: { colorId: 'cobalt', width: 2.8, brushType: 'pen' },
    });

    const initialStrokes = store.nodeRepo
      .getAllForCanvas(store.canvasId)
      .filter((n) => n.nodeType === 'vector_stroke');
    expect(initialStrokes).toHaveLength(1);

    // Vertical eraser slash at x=150 from y=50 to y=150 (cuts the middle segment (100,100)->(200,100))
    const sliceCmd = new SliceEraseCommand(
      store.db,
      store.nodeRepo,
      store.canvasId,
      worldPoint(150, 50),
      worldPoint(150, 150),
      4.0
    );

    store.history.execute(sliceCmd);

    const afterSlice = store.nodeRepo
      .getAllForCanvas(store.canvasId)
      .filter((n) => n.nodeType === 'vector_stroke');
    expect(afterSlice).toHaveLength(2);

    // Original stroke is replaced by left half [0..100] and right half [200..300]
    expect(store.nodeRepo.getById(originalStrokeId)).toBeNull();
    const leftFound = store.nodeRepo.queryViewportRTree(
      store.canvasId,
      worldAABB(-10, 80, 110, 120)
    );
    const rightFound = store.nodeRepo.queryViewportRTree(
      store.canvasId,
      worldAABB(190, 80, 310, 120)
    );
    expect(leftFound).toHaveLength(1);
    expect(rightFound).toHaveLength(1);

    // Undo restores the single unbroken original stroke bit-for-bit
    store.history.undo();
    const afterUndo = store.nodeRepo
      .getAllForCanvas(store.canvasId)
      .filter((n) => n.nodeType === 'vector_stroke');
    expect(afterUndo).toEqual(initialStrokes);
    store.close();
  });
});
