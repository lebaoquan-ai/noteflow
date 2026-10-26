import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CanvasStore } from '../../src/state/canvas_store.js';
import { TabletPointerBridge } from '../../src/ui/scene_graph/pointer_bridge.js';

describe('TabletPointerBridge — Low-Latency Stylus & Bimanual Touch Pipeline (Headless Verification)', () => {
  let store: CanvasStore;
  let bridge: TabletPointerBridge;
  let wetRepaints: number;
  let dryRepaints: number;

  beforeEach(() => {
    vi.useFakeTimers();
    store = CanvasStore.createInMemory('Tablet Input Prototype');
    wetRepaints = 0;
    dryRepaints = 0;
    bridge = new TabletPointerBridge(store, {
      onWetRepaint: () => {
        wetRepaints++;
      },
      onDryRepaint: () => {
        dryRepaints++;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    store.close();
  });

  it('streams coalesced & predicted stylus samples into WetStrokeBuffer on pointermove and commits world-space stroke on pointerup', () => {
    // Pan camera first to prove screen->world projection occurs on commit
    store.panCamera(100, 50);

    bridge.handlePointerDown({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 120,
      clientY: 80,
      pressure: 0.6,
      timeStamp: 10,
    });
    expect(bridge.gestureState).toBe('PEN_DRAWING');
    expect(bridge.wetBuffer.committedCount).toBe(1);

    bridge.handlePointerMove({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 200,
      clientY: 160,
      pressure: 0.8,
      timeStamp: 26,
      getCoalescedEvents: () => [
        {
          pointerId: 1,
          pointerType: 'pen',
          clientX: 160,
          clientY: 120,
          pressure: 0.7,
          timeStamp: 18,
        },
        {
          pointerId: 1,
          pointerType: 'pen',
          clientX: 200,
          clientY: 160,
          pressure: 0.8,
          timeStamp: 26,
        },
      ],
      getPredictedEvents: () => [
        {
          pointerId: 1,
          pointerType: 'pen',
          clientX: 220,
          clientY: 180,
          pressure: 0.8,
          timeStamp: 34,
        },
      ],
    });

    expect(bridge.wetBuffer.committedCount).toBe(3);
    expect(bridge.wetBuffer.predictedCount).toBe(1);
    expect(wetRepaints).toBeGreaterThanOrEqual(2);

    // Reject palm touch while pen is drawing
    bridge.handlePointerDown({
      pointerId: 2,
      pointerType: 'touch',
      clientX: 400,
      clientY: 400,
      pressure: 0.5,
      timeStamp: 28,
    });
    expect(bridge.gestureState).toBe('PEN_DRAWING');

    bridge.handlePointerUp({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 200,
      clientY: 160,
      pressure: 0.8,
      timeStamp: 30,
    });

    expect(bridge.gestureState).toBe('IDLE');
    expect(bridge.wetBuffer.committedCount).toBe(0);
    expect(dryRepaints).toBeGreaterThanOrEqual(1);

    // Verify stroke was committed in World Space (clientX - 100, clientY - 50)
    const strokes = store.nodeRepo
      .getAllForCanvas(store.canvasId)
      .filter((n) => n.nodeType === 'vector_stroke');
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.strokePoints![0]).toBeCloseTo(20, 4); // 120 - 100
    expect(strokes[0]!.strokePoints![1]).toBeCloseTo(30, 4); // 80 - 50
  });

  it('aborts and clears wet ink with zero DB writes when OS fires pointercancel (palm rejection)', () => {
    bridge.handlePointerDown({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 50,
      clientY: 50,
      pressure: 0.5,
      timeStamp: 10,
    });
    bridge.handlePointerMove({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 90,
      clientY: 90,
      pressure: 0.7,
      timeStamp: 20,
    });
    expect(bridge.wetBuffer.committedCount).toBe(2);

    bridge.handlePointerCancel({
      pointerId: 1,
      pointerType: 'pen',
      clientX: 90,
      clientY: 90,
      pressure: 0,
      timeStamp: 22,
    });

    expect(bridge.gestureState).toBe('IDLE');
    expect(bridge.wetBuffer.committedCount).toBe(0);
    expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(0);
  });

  it('pans on 1-finger drag (>8px slop), pinch-zooms on 2-finger spread, and undoes on 2-finger tap', () => {
    const notesLayer = store.getLayerByType('notes');
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([10, 10, 0.5, 1, 50, 50, 0.5, 2]),
    });
    expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(1);

    // 1. 1-finger drag beyond 8px slop -> pans camera
    bridge.handlePointerDown({
      pointerId: 10,
      pointerType: 'touch',
      clientX: 200,
      clientY: 200,
      pressure: 0.5,
      timeStamp: 100,
    });
    expect(bridge.gestureState).toBe('TOUCH_1_PENDING');

    bridge.handlePointerMove({
      pointerId: 10,
      pointerType: 'touch',
      clientX: 250,
      clientY: 230,
      pressure: 0.5,
      timeStamp: 116,
    });
    expect(bridge.gestureState).toBe('TOUCH_PANNING');
    expect(store.camera.panX).toBe(50);
    expect(store.camera.panY).toBe(30);

    bridge.handlePointerUp({
      pointerId: 10,
      pointerType: 'touch',
      clientX: 250,
      clientY: 230,
      pressure: 0.5,
      timeStamp: 130,
    });
    expect(bridge.gestureState).toBe('IDLE');

    // 2. 2-finger tap (<250ms, <=8px movement) -> triggers Undo!
    bridge.handlePointerDown({
      pointerId: 11,
      pointerType: 'touch',
      clientX: 300,
      clientY: 300,
      pressure: 0.5,
      timeStamp: 200,
    });
    bridge.handlePointerDown({
      pointerId: 12,
      pointerType: 'touch',
      clientX: 380,
      clientY: 300,
      pressure: 0.5,
      timeStamp: 205,
    });
    expect(bridge.gestureState).toBe('TOUCH_PINCH_ZOOMING');

    bridge.handlePointerUp({
      pointerId: 11,
      pointerType: 'touch',
      clientX: 301,
      clientY: 300,
      pressure: 0.5,
      timeStamp: 260,
    });
    bridge.handlePointerUp({
      pointerId: 12,
      pointerType: 'touch',
      clientX: 380,
      clientY: 301,
      pressure: 0.5,
      timeStamp: 265,
    });

    // Stroke was undone by 2-finger tap!
    expect(store.nodeRepo.getAllForCanvas(store.canvasId)).toHaveLength(0);
  });
});
