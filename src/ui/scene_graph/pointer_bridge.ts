import {
  screenPoint,
  type WorldPoint,
} from '../../core/canvas/types.js';
import { screenToWorld } from '../../core/canvas/math.js';
import { SliceEraseCommand } from '../../core/commands/slice_erase_command.js';
import {
  gestureReducer,
  HOLD_TIMEOUT_MS,
  isBeyondTouchSlop,
  type GestureState,
} from '../../state/gesture_fsm.js';
import type { CanvasStore } from '../../state/canvas_store.js';
import {
  ingestPointerMove,
  normalizePressure,
  WetStrokeBuffer,
  type PointerSampleEvent,
} from './wet_ink_buffer.js';

export interface BridgePointerEvent extends PointerSampleEvent {
  readonly pointerId: number;
}

interface TrackedTouch {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  currentX: number;
  currentY: number;
  readonly startTime: number;
  movedBeyondSlop: boolean;
}

export interface TabletPointerBridgeCallbacks {
  readonly onWetRepaint?: () => void;
  readonly onDryRepaint?: () => void;
  readonly onStateChange?: (state: GestureState) => void;
  readonly onLassoSelection?: (selectedIds: readonly string[]) => void;
}

export class TabletPointerBridge {
  public readonly wetBuffer = new WetStrokeBuffer();
  private _gestureState: GestureState = 'IDLE';
  private readonly activeTouches = new Map<number, TrackedTouch>();
  private maxConcurrentTouchesInGesture = 0;
  private anyTouchMovedBeyondSlop = false;
  private gestureStartTimestamp = 0;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPinchDistance: number | null = null;
  private lastPinchCenter: { x: number; y: number } | null = null;

  public constructor(
    private readonly store: CanvasStore,
    private readonly callbacks: TabletPointerBridgeCallbacks = {}
  ) {}

  public get gestureState(): GestureState {
    return this._gestureState;
  }

  public handlePointerDown(e: BridgePointerEvent): void {
    const isStylusOrMouse = e.pointerType === 'pen' || e.pointerType === 'mouse';

    if (isStylusOrMouse) {
      this.clearHoldTimer();
      this.transition({
        type: 'PEN_DOWN',
        x: e.clientX,
        y: e.clientY,
        pressure: normalizePressure(e),
      });

      this.wetBuffer.reset();
      this.wetBuffer.appendCommitted(
        e.clientX,
        e.clientY,
        normalizePressure(e),
        e.timeStamp
      );
      this.callbacks.onWetRepaint?.();
      return;
    }

    // Touch input: enforce palm rejection if stylus is already drawing
    if (
      this._gestureState === 'PEN_DRAWING' ||
      this._gestureState === 'TOUCH_HOLD_PEN_LASSOING'
    ) {
      return;
    }

    if (this.activeTouches.size === 0) {
      this.maxConcurrentTouchesInGesture = 0;
      this.anyTouchMovedBeyondSlop = false;
      this.gestureStartTimestamp = e.timeStamp;
    }

    this.activeTouches.set(e.pointerId, {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      startTime: e.timeStamp,
      movedBeyondSlop: false,
    });

    if (this.activeTouches.size > this.maxConcurrentTouchesInGesture) {
      this.maxConcurrentTouchesInGesture = this.activeTouches.size;
    }

    const touchList = [...this.activeTouches.values()].map((t) => ({
      id: t.pointerId,
      x: t.currentX,
      y: t.currentY,
    }));

    this.transition({ type: 'TOUCH_START', touches: touchList });

    if (this.activeTouches.size === 1) {
      this.clearHoldTimer();
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (
          this._gestureState === 'TOUCH_1_PENDING' &&
          !this.anyTouchMovedBeyondSlop
        ) {
          this.transition({ type: 'TOUCH_HOLD_TIMEOUT' });
        }
      }, HOLD_TIMEOUT_MS);
    } else {
      this.clearHoldTimer();
      this.updatePinchBaseline();
    }
  }

  public handlePointerMove(e: BridgePointerEvent): void {
    const isStylusOrMouse = e.pointerType === 'pen' || e.pointerType === 'mouse';

    if (isStylusOrMouse) {
      if (
        this._gestureState !== 'PEN_DRAWING' &&
        this._gestureState !== 'TOUCH_HOLD_PEN_LASSOING'
      ) {
        return;
      }

      const prevCount = this.wetBuffer.committedCount;
      ingestPointerMove(e, this.wetBuffer);

      // Real-time Slice Eraser during stylus drag
      if (
        this._gestureState === 'PEN_DRAWING' &&
        this.store.activeTool === 'stroke_eraser' &&
        this.wetBuffer.committedCount >= 2 &&
        prevCount >= 1
      ) {
        const lastIdx = (this.wetBuffer.committedCount - 1) * 4;
        const prevIdx = (this.wetBuffer.committedCount - 2) * 4;
        const wStart = screenToWorld(
          screenPoint(
            this.wetBuffer.committedData[prevIdx]!,
            this.wetBuffer.committedData[prevIdx + 1]!
          ),
          this.store.camera
        );
        const wEnd = screenToWorld(
          screenPoint(
            this.wetBuffer.committedData[lastIdx]!,
            this.wetBuffer.committedData[lastIdx + 1]!
          ),
          this.store.camera
        );
        const sliceCmd = new SliceEraseCommand(
          this.store.db,
          this.store.nodeRepo,
          this.store.canvasId,
          wStart,
          wEnd,
          8.0 / this.store.camera.zoom
        );
        this.store.history.execute(sliceCmd);
        this.callbacks.onDryRepaint?.();
      }

      this.callbacks.onWetRepaint?.();
      return;
    }

    // Touch move
    const tracked = this.activeTouches.get(e.pointerId);
    if (!tracked) return;

    const dx = e.clientX - tracked.currentX;
    const dy = e.clientY - tracked.currentY;
    tracked.currentX = e.clientX;
    tracked.currentY = e.clientY;

    if (
      !tracked.movedBeyondSlop &&
      isBeyondTouchSlop(tracked.startX, tracked.startY, e.clientX, e.clientY)
    ) {
      tracked.movedBeyondSlop = true;
      this.anyTouchMovedBeyondSlop = true;
      this.clearHoldTimer();
      if (this._gestureState === 'TOUCH_1_PENDING') {
        this.transition({ type: 'TOUCH_MOVE_BEYOND_SLOP' });
      }
    }

    if (this._gestureState === 'TOUCH_PANNING' && this.activeTouches.size === 1) {
      this.store.panCamera(dx, dy);
      this.callbacks.onDryRepaint?.();
      return;
    }

    if (
      this._gestureState === 'TOUCH_PINCH_ZOOMING' &&
      this.activeTouches.size >= 2
    ) {
      const pts = [...this.activeTouches.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      const centerX = (p0.currentX + p1.currentX) / 2;
      const centerY = (p0.currentY + p1.currentY) / 2;
      const dist = Math.hypot(
        p1.currentX - p0.currentX,
        p1.currentY - p0.currentY
      );

      if (this.lastPinchCenter) {
        this.store.panCamera(
          centerX - this.lastPinchCenter.x,
          centerY - this.lastPinchCenter.y
        );
      }
      if (this.lastPinchDistance && this.lastPinchDistance > 4 && dist > 4) {
        const ratio = dist / this.lastPinchDistance;
        this.store.zoomCamera(screenPoint(centerX, centerY), ratio);
      }

      this.lastPinchCenter = { x: centerX, y: centerY };
      this.lastPinchDistance = dist;
      this.callbacks.onDryRepaint?.();
    }
  }

  public handlePointerUp(e: BridgePointerEvent): void {
    const isStylusOrMouse = e.pointerType === 'pen' || e.pointerType === 'mouse';

    if (isStylusOrMouse) {
      const priorState = this._gestureState;
      this.transition({ type: 'PEN_UP' });

      if (
        priorState !== 'PEN_DRAWING' &&
        priorState !== 'TOUCH_HOLD_PEN_LASSOING'
      ) {
        this.wetBuffer.reset();
        this.callbacks.onWetRepaint?.();
        return;
      }

      const rawScreenPts = this.wetBuffer.exportCommittedCopy();
      this.wetBuffer.reset();
      this.callbacks.onWetRepaint?.();

      const numPts = Math.floor(rawScreenPts.length / 4);
      if (numPts === 0) return;

      // Convert screen coordinates to infinite world coordinates
      const worldPtsFlat = new Float32Array(rawScreenPts.length);
      const worldPolygon: WorldPoint[] = [];
      for (let i = 0; i < numPts; i++) {
        const sx = rawScreenPts[i * 4]!;
        const sy = rawScreenPts[i * 4 + 1]!;
        const p = rawScreenPts[i * 4 + 2]!;
        const t = rawScreenPts[i * 4 + 3]!;
        const wPt = screenToWorld(screenPoint(sx, sy), this.store.camera);
        worldPtsFlat[i * 4] = wPt.x;
        worldPtsFlat[i * 4 + 1] = wPt.y;
        worldPtsFlat[i * 4 + 2] = p;
        worldPtsFlat[i * 4 + 3] = t;
        worldPolygon.push(wPt);
      }

      const isLassoMode =
        priorState === 'TOUCH_HOLD_PEN_LASSOING' ||
        this.store.activeTool === 'freehand_lasso';

      if (isLassoMode) {
        const selected = this.store.selectNodesInLasso(worldPolygon);
        this.callbacks.onLassoSelection?.(selected.map((s) => s.id));
        if (selected.length > 0) {
          this.store.triggerCircleToAction(worldPolygon, 'verify_claim');
        }
        this.callbacks.onDryRepaint?.();
        return;
      }

      if (
        this.store.activeTool === 'stroke_eraser' ||
        this.store.activeTool === 'pan_laser'
      ) {
        this.callbacks.onDryRepaint?.();
        return;
      }

      const activeLayer = this.store.getLayerByType('notes');
      this.store.commitStroke({
        layerId: activeLayer.id,
        points: worldPtsFlat,
      });
      this.callbacks.onDryRepaint?.();
      return;
    }

    // Touch up
    if (!this.activeTouches.has(e.pointerId)) return;
    this.activeTouches.delete(e.pointerId);
    this.clearHoldTimer();

    if (this.activeTouches.size === 0) {
      const duration = e.timeStamp - this.gestureStartTimestamp;
      if (!this.anyTouchMovedBeyondSlop && duration <= 250) {
        if (this.maxConcurrentTouchesInGesture === 2) {
          this.store.history.undo();
          this.callbacks.onDryRepaint?.();
        } else if (this.maxConcurrentTouchesInGesture === 3) {
          this.store.history.redo();
          this.callbacks.onDryRepaint?.();
        }
      }
      this.lastPinchCenter = null;
      this.lastPinchDistance = null;
    } else {
      this.updatePinchBaseline();
    }

    this.transition({
      type: 'TOUCH_END',
      remainingTouches: this.activeTouches.size,
    });
  }

  public handlePointerCancel(e: BridgePointerEvent): void {
    const isStylusOrMouse = e.pointerType === 'pen' || e.pointerType === 'mouse';
    if (isStylusOrMouse) {
      this.wetBuffer.reset();
      this.transition({ type: 'PEN_CANCEL' });
      this.callbacks.onWetRepaint?.();
      return;
    }

    this.activeTouches.clear();
    this.clearHoldTimer();
    this.lastPinchCenter = null;
    this.lastPinchDistance = null;
    this.transition({ type: 'TOUCH_CANCEL' });
  }

  private updatePinchBaseline(): void {
    if (this.activeTouches.size >= 2) {
      const pts = [...this.activeTouches.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      this.lastPinchCenter = {
        x: (p0.currentX + p1.currentX) / 2,
        y: (p0.currentY + p1.currentY) / 2,
      };
      this.lastPinchDistance = Math.hypot(
        p1.currentX - p0.currentX,
        p1.currentY - p0.currentY
      );
    } else {
      this.lastPinchCenter = null;
      this.lastPinchDistance = null;
    }
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private transition(event: Parameters<typeof gestureReducer>[1]): void {
    const next = gestureReducer(this._gestureState, event);
    if (next !== this._gestureState) {
      this._gestureState = next;
      this.callbacks.onStateChange?.(next);
    }
  }
}
