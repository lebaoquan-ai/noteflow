# NoteFlow — Antigravity Agent Instructions

You are building **NoteFlow**, a Stylus-First, AI-Native Spatial Zettelkasten for tablets.
The master architectural specification lives at `docs/SPEC.md`. Read relevant sections before planning any task.

## 1. Execution Discipline (Plan -> Narrow Change -> Verify)
- **Never boil the ocean:** Only implement the specific vertical slice or milestone requested by the user.
- **No `// TODO` or mock stubs in committed logic:** If a task scopes a module (e.g., `gesture_fsm.ts` or `schema.sql`), implement it completely with real unit/headless tests.
- **Mandatory Verification Gate:** You may NOT mark a task complete until `npm run typecheck` and `npm run test:headless` pass with 0 errors.
- **Consult Agent Skills:** Use project runbooks in `.agents/skills/` (`vertical-slice-tdd`, `spatial-rtree-sqlite`, `vector-ink-math`, `wet-dry-ink-pipeline`, `headless-canvas-simulator`, `systematic-debugging`) whenever working on respective domains.

## 2. Non-Negotiable Architectural Invariants
1. **Zero Implicit State:** Never use `window.*` globals. All canvas mutations MUST execute through an undoable `CanvasCommand` in `src/core/commands/`.
2. **Runtime Zod Validation:** Every boundary (SQLite row parsing, Worker messages, AI Tool calls, Bridge events) MUST be validated with a Zod schema.
3. **Pure Core:** Files inside `src/core/**` must have ZERO imports from `react`, DOM APIs, or `src/ui/**`.
4. **Scope Control:** Do not refactor or modify files outside your assigned task scope without stopping and asking the user first.
