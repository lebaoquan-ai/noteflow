---
name: systematic-debugging
description: 4-phase root-cause debugging methodology for NoteFlow spatial geometry, Gesture FSM transitions, SQLite R-Tree triggers, and CanvasCommand undo/redo drift. Use whenever a test fails, a bug is reported, or unexpected behavior occurs.
---

# NoteFlow Systematic Debugging Playbook

Never guess-and-patch when a headless test, spatial query, or gesture transition fails. Follow this strict 4-phase root-cause protocol.

## Phase 1: Reproduce & Minimize (Headless First)

1. **Capture the Exact Failure:**
   - Read the full Vitest or `tsc` error output without skimming.
   - If a property-based test (`fast-check`) failed, copy the shrunk counterexample seed/inputs into a deterministic standalone `it()` block in `tests/headless/`.
2. **Forbidden Action:** Do NOT edit implementation code in `src/` before you have a deterministic failing assertion in `tests/headless/`.

## Phase 2: Isolate the Domain Invariant

Trace the failure against NoteFlow's 4 core failure domains:

### A. Spatial & Floating-Point Math (`src/core/canvas/`)
- **Coordinate Space Mixup:** Was a `ScreenPoint` passed where a `WorldPoint` was expected (or vice-versa)? Check if camera `(panX, panY, zoom, rotation)` was applied twice or omitted.
- **Degenerate Geometry:**
  - *Single-point stroke (tap):* Does `computeStrokeAABB` expand by `max(strokeWidth / 2, 0.5)` so `min_x < max_x`?
  - *Collinear / Coincident points in RDP:* Does `perpendicularDistance` guard against `mag < 1e-9` (division by zero returning `NaN`)?
  - *AABB Inversion:* Did a negative scale or unnormalized lasso drag produce `min_x > max_x` (which causes SQLite R-Tree `rtree` constraint errors)?

### B. SQLite R-Tree & Triggers (`src/db/`)
- **UUID vs. `rowid` Join:** Did a query join `spatial_nodes.id = spatial_nodes_rtree.id` (wrong—comparing UUID text to integer) instead of `spatial_nodes.rowid = spatial_nodes_rtree.id`?
- **Trigger Bypass:** Did an `UPDATE` modify `vector_payload` without updating `min_x, min_y, max_x, max_y` (leaving `spatial_nodes_rtree` stale)?
- **AABB Overlap Condition:** Verify the 4-inequality overlap check:
  `r.min_x <= :queryMaxX AND r.max_x >= :queryMinX AND r.min_y <= :queryMaxY AND r.max_y >= :queryMinY`.

### C. Gesture FSM (`src/state/gesture_fsm.ts`)
- **Stuck State / Missing Reset:** Log `(prevState, event) => nextState`. Did a `pointercancel` or multi-finger liftoff (`remainingTouches > 0` followed by lost `TOUCH_END`) leave the FSM outside `IDLE`?
- **Timer Leak:** Was the 220ms `TOUCH_HOLD_TIMEOUT` timer cleared when `TOUCH_MOVE_BEYOND_SLOP`, `PEN_DOWN`, or `TOUCH_END` occurred first?

### D. CanvasCommand Undo/Redo Symmetry (`src/core/commands/`)
- **Partial State Restoration:** Diff the pre-`execute()` DB snapshot against the post-`undo()` DB snapshot (`spatial_nodes`, `spatial_nodes_rtree`, `async_jobs`).
- **Relative vs. Absolute Mutation:** If `execute()` used floating-point addition (`x + deltaX`) and `undo()` used (`x - deltaX`), check for floating-point drift or store exact prior bounding boxes in the command closure.

## Phase 3: Minimal Invariant-Preserving Fix

1. Fix the root cause identified in Phase 2 at the source boundary (never paper over a broken invariant with a downstream fallback or `try/catch`).
2. Keep the diff strictly limited to the root cause.

## Phase 4: Verification Gate

1. Run the reproduction test and the full property-based test suite:
   `npm run test:headless`
2. Run strict type checking:
   `npm run typecheck`
3. Both commands MUST exit with code `0` before reporting the fix complete.
