---
name: vertical-slice-tdd
description: Executes a feature slice from docs/SPEC.md using strict Headless-First Test-Driven Development (TDD). Use whenever implementing a new milestone, command, state machine, repository, or UI component.
---

# Vertical Slice TDD Workflow

Whenever implementing a feature slice or milestone from `docs/SPEC.md`, follow this exact 5-step sequence:

## Step 1: Spec Alignment, AST Discovery & Plan Artifact
1. Read the relevant section of `docs/SPEC.md`.
2. For files `>150` lines, run `npm run ctx -- symbols <file>` or `npm run ctx -- symbol <Name>` first (or delegate multi-file discovery to a `research` subagent) so you only read the exact `StartLine`–`EndLine` ranges needed.
3. State the exact files you will create or modify and the invariants involved. Do not touch files outside that list.
4. Review relevant domain skills (`spatial-rtree-sqlite`, `vector-ink-math`, `wet-dry-ink-pipeline`, `headless-canvas-simulator`, `systematic-debugging`).

## Step 2: Write the Headless Test First (`tests/headless/`)
1. Before writing UI or implementation code, write a failing headless test in `tests/headless/` (using Vitest and `fast-check` property-based assertions where applicable) that simulates the input (e.g., synthetic `PointerEvent` stream, `CanvasCommand` execution, or SQLite query).
2. Run `npm run verify:gate` (or `npm run test:headless`) to confirm the test fails as expected (RED) with minimal output bloat.

## Step 3: Implement Pure Core / DB / State
1. Implement the Zod schemas, branded coordinate types (`ScreenPoint`, `WorldPoint`), SQLite repository methods, or FSM/Command logic required to pass the test (GREEN).
2. Follow strict core invariants:
   - Zero React/DOM imports in `src/core/**`.
   - Every mutation wrapped in an undoable `CanvasCommand` executing inside an atomic SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`).
   - SQLite R-Tree virtual table ID maps to `spatial_nodes.rowid`.
3. Run `npm run verify:gate` (`tsc --noEmit` + Pure-Core invariants + `vitest run tests/headless --reporter=dot --bail=1`) until it returns `"status":"PASS"`.

## Step 4: Wire to UI / Scene Graph (If in Scope)
1. Bind the verified state/command to the React UI or Unified Scene Graph in `src/ui/`.
2. Ensure active pen drawing (`PEN_DOWN` to `PEN_UP`) renders through the decoupled wet-ink canvas without triggering React component re-renders on `pointermove`.
3. Re-run `npm run typecheck` and `npm run test:headless`.

## Step 5: Self-Audit Before Reporting
1. Search your changed files for any `TODO`, `FIXME`, `any` types, or unvalidated inputs.
2. Verify undo/redo symmetry: executing a command and calling undo restores state identically.
3. Confirm both `npm run typecheck` and `npm run test:headless` are green before declaring completion.
