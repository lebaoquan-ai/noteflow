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

## 3. Context Engineering & Tool Hygiene (Self-Managed)
1. **AST Symbol-First Reads (No Blind File Dumps):** Never read a full file `>150` lines without first running `npm run ctx -- symbols <file>`, `npm run ctx -- symbol <Name>`, or `grep -n` to get exact `StartLine`–`EndLine` bounds for `read_file`.
2. **Pre-Filtered Shell & Deterministic TDD Gate:**
   - Always pipe search or directory commands through `| head -n 30`.
   - Use `npm run verify:gate` (runs `tsc --noEmit` + Pure-Core invariant check + `vitest run tests/headless --reporter=dot --bail=1` and outputs a single compact JSON line) during TDD loops.
   - If a tool call or fix attempt fails twice consecutively, stop looping and either isolate via a subagent or ask the user.
3. **Subagent Context Firewall & Schema Handoffs:** Delegate open-ended multi-file discovery or pre-review verification to a subagent (`invoke_subagent`) instructed to return ONLY a compact JSON/markdown summary (`<250 tokens`: `file`, `lines`, `signature`, `fix_instruction`).
4. **Proactive User Context Reminders:** At the end of major planning or milestone turns, append a brief **Context & Tool Reminder** advising the user when to run `/compact`, `/clear` (re-anchoring on `@docs/...`), or `/rewind`.
