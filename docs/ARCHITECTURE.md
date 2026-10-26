# NoteFlow — System Architecture & Upgradability Guide

This document defines the module boundaries, invariants, and extension points of **NoteFlow** as specified in [`docs/SPEC.md`](./SPEC.md).

---

## 1. Strict Layered Dependency DAG

To keep the codebase readable, testable in `<500ms` without a browser/GPU, and upgradable across platforms (Web, iPadOS, Android Tablet), imports follow a strict one-way Directed Acyclic Graph (DAG):

```
src/core/canvas/*     (Zero external dependencies except Zod; pure math & branded types)
       ▲
src/db/*              (Depends only on src/core/canvas/types.ts + SqlEnginePort)
       ▲
src/core/commands/*   (Depends only on src/core/canvas/* and src/db/*)
       ▲
src/ai/* & src/state/*(Coordinates commands, Tier 0-4 intelligence, gesture FSM, and scene frames)
       ▲
src/ui/*              (Ephemeral Wet-Ink <canvas>, Unified Dry <canvas>, Hardware Pointer Bridge, UI Chrome)
```

### Non-Negotiable Invariants
1. **Zero Implicit Globals:** Never read or write `window.*` state. Every canvas mutation executes through an undoable `CanvasCommand` in `src/core/commands/`.
2. **Branded Coordinate Safety:** Screen coordinates (`ScreenPoint`) and world coordinates (`WorldPoint`, `WorldAABB`) are nominally branded. Conversions must go through `screenToWorld` and `worldToScreen` in `src/core/canvas/math.ts`.
3. **64-Bit R-Tree Key Invariant:** `spatial_nodes.id` is a UUID (`NodeId`), while `spatial_nodes_rtree.id` is a 64-bit integer mapped to `spatial_nodes.rowid` via automatic SQLite triggers (`sync_rtree_insert`, `sync_rtree_update`, `sync_rtree_delete`).
4. **Zero-Allocation Hot Loop:** During active stylus drawing (`PEN_DRAWING`), pointer samples are written into pre-allocated `Float32Array` slabs (`WetStrokeBuffer`) and rendered on a `desynchronized: true` overlay `<canvas>`.

---

## 2. Upgradability & Extension Seams (Ports & Adapters)

1. **Database Engine Port (`src/db/engine_port.ts`):**
   - `NoteFlowDatabase` accepts any implementation of `SqlEnginePort`.
   - In Node/Vitest, it automatically loads `node:sqlite` (`DatabaseSync`) with `src/db/schema.sql`.
   - In Browser/Tablet environments, it uses `BrowserSqlEngine` (`src/db/browser_sql_engine.ts`) or a Web Worker OPFS SQLite WASM adapter without changing a single line in `src/db/repositories/*` or `src/core/commands/*`.
2. **Adding a New Canvas Mutation:**
   - Implement `CanvasCommand` (`execute()` and `undo()` wrapped in `db.transaction(...)`) inside `src/core/commands/`.
   - Register a headless unit test in `tests/headless/` verifying bit-for-bit state restoration after `execute() -> undo()`.
3. **Upgrading AI Tiers (Tiers 1–4):**
   - All AI outputs that mutate badges or canvas nodes must validate against the Zod schemas in `src/ai/agent_contract.ts` (`UpdateJobBadgeToolSchema`, `CreateZettelCardToolSchema`) and check `AsyncJobQueue.getAbortSignal(jobId)` before committing.
