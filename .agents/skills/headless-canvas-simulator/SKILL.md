---
name: headless-canvas-simulator
description: Testing recipes, synthetic event simulators, and property-based fuzz testing (fast-check) for NoteFlow headless tests in Vitest. Use whenever writing headless tests for Gesture FSM, CanvasCommands, spatial math, digitizer events, or AI badge lifecycle.
---

# NoteFlow Headless Canvas Simulator & Property-Based Testing Runbook

This skill outlines how to write deterministic unit tests and `fast-check` property-based fuzz tests in `tests/headless/` without physical tablet hardware, DOM dependencies, or WebGL contexts.

## 1. Principles of Headless Testing in NoteFlow

1. **Pure Core Isolation:** Test domain logic (`src/core/**` and `src/state/**`) purely in Node/Vitest.
2. **Deterministic Time:** Use `vi.useFakeTimers()` to verify the 220ms gesture hold threshold and 1200ms stroke debounce timers without waiting wall-clock time.
3. **Synthetic Digitizer Streams:** Never simulate browser click events. Simulate raw hardware coordinates, touch IDs, and `pointerType: 'pen'` vs `'touch'`.
4. **Property-Based Fuzzing (`fast-check`):** Pair example-based tests with `fc.assert(fc.property(...))` to prove mathematical and state-machine invariants across thousands of randomized inputs.

## 2. Gesture FSM Example & Property-Based Test Template

```typescript
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { gestureReducer, type GestureState, type GestureEvent } from '../../src/state/gesture_fsm.js';

const gestureEventArb: fc.Arbitrary<GestureEvent> = fc.oneof(
  fc.record({
    type: fc.constant('PEN_DOWN' as const),
    x: fc.double({ min: -10000, max: 10000, noNaN: true }),
    y: fc.double({ min: -10000, max: 10000, noNaN: true }),
    pressure: fc.double({ min: 0.05, max: 1.0, noNaN: true }),
  }),
  fc.constant({ type: 'PEN_UP' as const }),
  fc.constant({ type: 'PEN_CANCEL' as const }),
  fc.record({
    type: fc.constant('TOUCH_START' as const),
    touches: fc.array(
      fc.record({
        id: fc.integer({ min: 1, max: 10 }),
        x: fc.double({ min: 0, max: 4000, noNaN: true }),
        y: fc.double({ min: 0, max: 4000, noNaN: true }),
      }),
      { minLength: 1, maxLength: 5 }
    ),
  }),
  fc.constant({ type: 'TOUCH_MOVE_BEYOND_SLOP' as const }),
  fc.constant({ type: 'TOUCH_HOLD_TIMEOUT' as const }),
  fc.constant({ type: 'VOICE_DETECTED' as const }),
  fc.record({
    type: fc.constant('TOUCH_END' as const),
    remainingTouches: fc.integer({ min: 0, max: 4 }),
  }),
  fc.constant({ type: 'TOUCH_CANCEL' as const })
);

describe('Gesture FSM Property-Based Invariants', () => {
  it('never deadlocks: releasing pen and all touches always returns FSM to IDLE from any reachable state', () => {
    fc.assert(
      fc.property(fc.array(gestureEventArb, { minLength: 1, maxLength: 50 }), (events) => {
        let state: GestureState = 'IDLE';
        for (const ev of events) {
          state = gestureReducer(state, ev);
        }
        // Universal hardware liftoff sequence
        state = gestureReducer(state, { type: 'PEN_UP' });
        state = gestureReducer(state, { type: 'TOUCH_END', remainingTouches: 0 });
        expect(state).toBe('IDLE');
      })
    );
  });
});
```

## 3. Spatial Math Property-Based Invariants (`fast-check`)

When testing `src/core/canvas/`, always assert these 3 mathematical properties:

1. **Camera Round-Trip Invertibility:**
   For any `ScreenPoint` $p$ and valid `CameraState` (`zoom ∈ [0.1, 32]`, `rotation ∈ [-π, π]`):
   $$\text{worldToScreen}(\text{screenToWorld}(p, \text{cam}), \text{cam}) \approx p \quad (\epsilon = 10^{-5})$$
2. **RDP Decimation Endpoint Preservation & Monotonicity:**
   For any polyline $P$ with $|P| \ge 2$ and $\epsilon > 0$:
   - `simplified[0]` equals `P[0]` and `simplified.at(-1)` equals `P.at(-1)`
   - `2 <= simplified.length <= P.length`
3. **AABB Containment:**
   For any stroke point stream, every sample $(x_i, y_i)$ satisfies:
   $$\text{minX} \le x_i \le \text{maxX} \quad \text{and} \quad \text{minY} \le y_i \le \text{maxY}$$

## 4. CanvasCommand Undo/Redo Test Pattern

Every `CanvasCommand` must satisfy strict symmetry:
```typescript
it('guarantees bit-for-bit state restoration on undo', async () => {
  const initialState = await snapshotCanvasState(db, canvasId);

  const command = new MoveNodesCommand(['node-1', 'node-2'], 50, -30);
  await command.execute(db);

  const modifiedState = await snapshotCanvasState(db, canvasId);
  expect(modifiedState).not.toEqual(initialState);

  await command.undo(db);

  const restoredState = await snapshotCanvasState(db, canvasId);
  expect(restoredState).toEqual(initialState);
});
```

## 5. Deterministic AI Job Lifecycle Replay

Test badge progression (`queued -> running -> completed`) synchronously:
```typescript
it('transitions badge through queued, running, completed states', async () => {
  const job = await queueVerificationJob(db, { anchorNodeId: 'node-cluster-1' });
  expect(job.status).toBe('queued');

  await executeJobWorkerStep(db, job.id);
  expect(getJob(db, job.id).status).toBe('running');

  await finishJobWorkerStep(db, job.id, {
    badgeColor: 'forest',
    summary: 'Claim verified by 3 sources',
    citations: ['https://example.com/source1'],
  });

  const completed = getJob(db, job.id);
  expect(completed.status).toBe('completed');
  expect(completed.badgeColor).toBe('forest');
});
```
