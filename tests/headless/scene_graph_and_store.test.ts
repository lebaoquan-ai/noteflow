import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  screenPoint,
  worldPoint,
  worldAABB,
} from '../../src/core/canvas/types.js';
import { worldToScreen } from '../../src/core/canvas/math.js';
import {
  WetStrokeBuffer,
  ingestPointerMove,
  type PointerSampleEvent,
} from '../../src/ui/scene_graph/wet_ink_buffer.js';
import { CanvasStore } from '../../src/state/canvas_store.js';

describe('Wet-Ink Zero-Alloc Pipeline, Smart Layers & Unified Scene Graph Store (Headless Verification)', () => {
  let store: CanvasStore;

  beforeEach(() => {
    store = CanvasStore.createInMemory('Differential Equations');
  });

  afterEach(() => {
    store.close();
  });

  it('ingests coalesced and predicted pointer events into pre-allocated Float32Array slabs without leaking predicted points into committed stroke exports', () => {
    const buffer = new WetStrokeBuffer();

    const syntheticEvent: PointerSampleEvent = {
      pointerType: 'pen',
      clientX: 120,
      clientY: 220,
      pressure: 0.75,
      timeStamp: 1016,
      getCoalescedEvents: () => [
        {
          pointerType: 'pen',
          clientX: 100,
          clientY: 200,
          pressure: 0.6,
          timeStamp: 1004,
        },
        {
          pointerType: 'pen',
          clientX: 110,
          clientY: 210,
          pressure: 0.7,
          timeStamp: 1010,
        },
        {
          pointerType: 'pen',
          clientX: 120,
          clientY: 220,
          pressure: 0.75,
          timeStamp: 1016,
        },
      ],
      getPredictedEvents: () => [
        {
          pointerType: 'pen',
          clientX: 132,
          clientY: 232,
          pressure: 0.75,
          timeStamp: 1024,
        },
      ],
    };

    ingestPointerMove(syntheticEvent, buffer);

    expect(buffer.committedCount).toBe(3);
    expect(buffer.predictedCount).toBe(1);

    const exported = buffer.exportCommittedCopy();
    expect(exported.length).toBe(12); // 3 points * 4 floats
    expect(exported[0]).toBe(100);
    expect(exported[1]).toBe(200);
    expect(exported[8]).toBe(120);
    expect(exported[9]).toBe(220);

    // On pointercancel (OS palm rejection), buffer resets cleanly to 0 points
    buffer.reset();
    expect(buffer.committedCount).toBe(0);
    expect(buffer.predictedCount).toBe(0);
  });

  it('switches Radial Wheel tools and automatically hides Hints & AI Annotations layers when Teaching Mode is enabled', () => {
    // Default tool is fountain_pen with 2.8mm standard width
    expect(store.activeTool).toBe('fountain_pen');
    expect(store.strokeStyle.width).toBe(2.8);

    // Selecting AI Highlighter switches brushType to 'highlighter' and color to 'violet'
    store.selectRadialTool('ai_highlighter');
    expect(store.activeTool).toBe('ai_highlighter');
    expect(store.strokeStyle.colorId).toBe('violet');
    expect(store.strokeStyle.brushType).toBe('highlighter');

    // Add one stroke on 'notes' layer and one stroke on 'hints_work' layer
    const notesLayer = store.getLayerByType('notes');
    const hintsLayer = store.getLayerByType('hints_work');

    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([100, 100, 0.6, 10, 200, 150, 0.8, 20]),
      style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
    });

    store.commitStroke({
      layerId: hintsLayer.id,
      points: new Float32Array([100, 300, 0.6, 30, 200, 350, 0.8, 40]),
      style: { colorId: 'amber', width: 2.8, brushType: 'pen' },
    });

    // When Teaching Mode is OFF, both strokes appear in the unified scene frame
    const frameNormal = store.buildSceneFrame(1024, 768);
    expect(
      frameNormal.visibleNodes.filter((n) => n.nodeType === 'vector_stroke')
    ).toHaveLength(2);

    // Enable Teaching Mode -> hides 'hints_work' and 'ai_feedback' layers
    store.setTeachingMode(true);
    expect(store.isTeachingMode).toBe(true);

    const frameTeaching = store.buildSceneFrame(1024, 768);
    const visibleStrokes = frameTeaching.visibleNodes.filter(
      (n) => n.nodeType === 'vector_stroke'
    );
    expect(visibleStrokes).toHaveLength(1);
    expect(visibleStrokes[0]!.layerId).toBe(notesLayer.id);
  });

  it('projects dry ink and AI job badges through the exact same CameraState in lockstep during pan and zoom', () => {
    const notesLayer = store.getLayerByType('notes');

    // Commit a violet AI highlight stroke to immediately create a cluster + queued badge
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([100, 200, 0.6, 10, 300, 240, 0.6, 30]),
      style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
    });

    // Pan and zoom the camera
    store.panCamera(150, -40);
    store.zoomCamera(screenPoint(512, 384), 2.0);

    const frame = store.buildSceneFrame(1024, 768);
    expect(frame.badges).toHaveLength(1);

    const badge = frame.badges[0]!;
    const expectedScreenPos = worldToScreen(
      worldPoint(badge.worldAnchorX, badge.worldAnchorY),
      frame.camera
    );

    expect(badge.screenX).toBeCloseTo(expectedScreenPos.x, 6);
    expect(badge.screenY).toBeCloseTo(expectedScreenPos.y, 6);
    expect(frame.visibleNodes.length).toBeGreaterThanOrEqual(2);
    expect(worldAABB(0, 0, 10, 10)).toBeDefined();
  });
});
