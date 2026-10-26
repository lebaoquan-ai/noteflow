---
trigger: glob
globs: "src/core/**, src/ai/**"
description: "Command pattern, branded spatial types, and 5-stage AI pipeline rules."
---

# Core Domain & AI Pipeline Rules

1. **Every CanvasCommand Must Be Atomic & Reversible:**
   - Every class implementing `CanvasCommand` in `src/core/commands/` must execute multi-node mutations inside an atomic SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`).
   - Every `CanvasCommand` must have an accompanying unit test in `tests/headless/` that runs `execute()`, asserts state, runs `undo()`, and asserts that the database/canvas state is bit-for-bit identical to the pre-execution state.
   - If `undo()` removes or ungroups an `anchor_node_id` that has an in-flight `async_job` (`queued` or `running`), the job must be aborted/cancelled so zombie badges never appear.

2. **Branded Coordinate & ID Types:**
   - Never pass raw screen coordinates (`ScreenPoint`) into world-space calculations, `spatial_nodes`, or R-Tree queries without first projecting via `screenToWorld(pt, camera): WorldPoint`.
   - Entity IDs in TypeScript are branded UUID strings (`NodeId`, `CanvasId`, `LayerId`); never leak SQLite integer `rowid` values into domain models.

3. **Never Call Cloud VLMs on Raw Strokes:**
   - Tier 4 Cloud Agents (`src/ai/tier4_cloud/`) may ONLY be invoked by explicit user triggers (Violet AI highlighter, Magic Lasso action, or Push-to-Talk voice).
