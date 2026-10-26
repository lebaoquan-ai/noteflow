---
name: wet-dry-ink-pipeline
description: Architectural runbook for the <4ms Ephemeral Wet-Ink Overlay, 120fps Unified Dry Scene Graph, high-frequency PointerEvent ingestion (getCoalescedEvents/getPredictedEvents/pointercancel), and zero-allocation render loops. Use whenever working on canvas rendering, stylus input bridges, or scene graph performance.
---

# NoteFlow Wet/Dry Ink Pipeline & High-Frequency Pointer Runbook

This skill governs the **Ephemeral-Wet / Unified-Dry Sandwich** (`docs/SPEC.md` §3) to guarantee `<4ms` active stylus latency and zero frame drops at 120Hz/240Hz.

## 1. High-Frequency PointerEvent Ingestion (`src/ui/` Hardware Bridge)

Tablet digitizers (Apple Pencil at 240Hz, S-Pen at 120Hz+) sample faster than display refresh rates.

### Coalesced & Predicted Events
1. **Committed Stroke Fidelity (`getCoalescedEvents`):**
   - Inside `pointermove`, ALWAYS iterate over `event.getCoalescedEvents?.() ?? [event]`.
   - Append only coalesced samples to the real stroke buffer (which will be simplified on `PEN_UP`). Failing to read coalesced events turns fast handwriting curves into jagged polygons.
2. **Latency Reduction (`getPredictedEvents`):**
   - Read `event.getPredictedEvents?.() ?? []` into a separate temporary tail buffer rendered *only* for the current frame on the Wet-Ink Overlay, then discarded before the next `pointermove`.
   - **Never commit predicted points into `StrokeCommittedEvent`!**
3. **Pressure & Tilt Normalization:**
   - For `pointerType === 'pen'`, clamp `event.pressure` to `[0.05, 1.0]`.
   - For fallback mouse/trackpad testing (`pointerType === 'mouse'`), normalize `pressure` to `0.5` when `event.buttons === 1`.

```typescript
export function ingestPointerMove(
  event: PointerEvent,
  wetBuffer: WetStrokeBuffer
): void {
  const coalesced = event.getCoalescedEvents?.() ?? [event];
  for (let i = 0; i < coalesced.length; i++) {
    const pt = coalesced[i];
    const pressure = pt.pointerType === 'pen' ? Math.max(0.05, pt.pressure) : 0.5;
    wetBuffer.pushRealPoint(pt.clientX, pt.clientY, pressure, pt.timeStamp);
  }

  wetBuffer.clearPredictedPoints();
  const predicted = event.getPredictedEvents?.() ?? [];
  for (let i = 0; i < predicted.length; i++) {
    const pt = predicted[i];
    const pressure = pt.pointerType === 'pen' ? Math.max(0.05, pt.pressure) : 0.5;
    wetBuffer.pushPredictedPoint(pt.clientX, pt.clientY, pressure, pt.timeStamp);
  }
}
```

## 2. Pointer Capture & OS Palm-Rejection (`pointercancel`)

On iPadOS and Android tablets, a resting palm often triggers `pointerdown` (`pointerType: 'touch'`) ~20–40ms before the OS hardware palm rejection fires **`pointercancel`**.

### Mandatory Lifecycle Rules
1. **Pointer Capture:** Call `target.setPointerCapture(event.pointerId)` on `pointerdown` and `target.releasePointerCapture(event.pointerId)` on `pointerup` / `pointercancel`.
2. **Handling `pointercancel`:**
   - If `event.pointerType === 'touch'` cancels: remove the touch ID from active touches and dispatch `{ type: 'TOUCH_CANCEL' }` (or `{ type: 'TOUCH_END', remainingTouches }`) to `gestureReducer` so the FSM never stays wedged in `TOUCH_1_PENDING` or `TOUCH_PANNING`.
   - If `event.pointerType === 'pen'` cancels: immediately clear the uncommitted `WetStrokeBuffer` without emitting a `StrokeCommittedEvent`, and dispatch `{ type: 'PEN_CANCEL' }` to return `gestureReducer` to `IDLE`.

## 3. Zero-Allocation Hot Path (120Hz/240Hz Frame Budget)

Garbage Collection (GC) pauses during active writing cause visible ink stutter.

### Strictly Forbidden Inside `pointermove` and `requestAnimationFrame`
- Array allocations: `.map()`, `.filter()`, `.slice()`, `.concat()`, `[...arr]`
- Object allocations: `{ x, y }`, `{ ...point }`, `new DOMPoint()`, `new Float32Array()` per frame
- React state updates: `useState` setters or Zustand actions that trigger React component re-renders on every pointer sample

### Required Pattern: Pre-Allocated `Float32Array` Ring/Slab Buffer
Pre-allocate a reusable `Float32Array` at canvas initialization:
```typescript
const STRIDE = 4; // [x, y, pressure, timestamp]
const MAX_STROKE_POINTS = 16384;

export class WetStrokeBuffer {
  readonly data = new Float32Array(MAX_STROKE_POINTS * STRIDE);
  readonly predicted = new Float32Array(64 * STRIDE);
  realCount = 0;
  predictedCount = 0;

  reset(): void {
    this.realCount = 0;
    this.predictedCount = 0;
  }

  pushRealPoint(x: number, y: number, pressure: number, timestamp: number): void {
    if (this.realCount >= MAX_STROKE_POINTS) return;
    const offset = this.realCount * STRIDE;
    this.data[offset] = x;
    this.data[offset + 1] = y;
    this.data[offset + 2] = pressure;
    this.data[offset + 3] = timestamp;
    this.realCount++;
  }

  clearPredictedPoints(): void {
    this.predictedCount = 0;
  }

  pushPredictedPoint(x: number, y: number, pressure: number, timestamp: number): void {
    if (this.predictedCount >= 64) return;
    const offset = this.predictedCount * STRIDE;
    this.predicted[offset] = x;
    this.predicted[offset + 1] = y;
    this.predicted[offset + 2] = pressure;
    this.predicted[offset + 3] = timestamp;
    this.predictedCount++;
  }

  /** Called ONLY once on PEN_UP to extract a compact Float32Array for StrokeCommittedEvent */
  exportCommittedPoints(): Float32Array {
    return this.data.slice(0, this.realCount * STRIDE);
  }
}
```

## 4. Zero-Flicker Wet-to-Dry Handoff on `PEN_UP`

1. On `PEN_UP`, project the committed points into `WorldPoint` coordinates via `screenToWorld()`, run RDP simplification, compute the `WorldAABB`, and emit `StrokeCommittedEvent`.
2. Insert the new node synchronously into the main-thread Scene Graph mirror and request a Dry Scene Graph paint.
3. Clear the top Ephemeral Wet-Ink `<canvas>` in the **same animation frame** that the Dry Scene Graph paints the committed stroke—preventing a 1-frame blink between `PEN_UP` and dry render.
