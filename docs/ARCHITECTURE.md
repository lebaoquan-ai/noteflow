# NoteFlow — System Architecture & Upgradability Guide (v2.0)

This document defines the module boundaries, architectural invariants, reconciled specification refinements, and extension seams (ports & adapters) of **NoteFlow** as specified in [`docs/SPEC_rework_v2.md`](./SPEC_rework_v2.md).

---

## 1. Strict Layered Dependency DAG

To keep the codebase Dual-Legible (for both human engineers and autonomous AI agents), testable in `<500ms` without a browser/GPU, and portable across Web, Android Tablet (Samsung Galaxy Tab S-Pen via Jetpack Ink / Vulkan), and iPadOS, imports follow a strict one-way Directed Acyclic Graph (DAG):

```
src/core/canvas/*, src/core/syntax/*, src/core/zettel/*
  (Pure domain math, branded coordinates, syntax AST, Zettelkasten hierarchy; ZERO external deps except Zod)
       ▲
src/db/*
  (Local-first persistence: SQLite schema, 64-bit R-Tree triggers, SqlEnginePort, repositories)
       ▲
src/core/commands/*
  (Atomic, synchronous, undoable CanvasCommand transactions over src/core/* and src/db/*)
       ▲
src/ai/* & src/state/*
  (Tier 0–4 intelligence pipeline, InkRecognitionPort, Bimanual Gesture FSM, AsyncJobQueue, CanvasStore)
       ▲
src/ui/* & native/*
  (Ephemeral Wet-Ink <canvas>/SurfaceView, Unified Dry Scene Graph, 9-Slot Radial Wheel, Bimanual Side-Drawer)
```

### Non-Negotiable Architectural Invariants

1. **Zero Implicit Globals & Pure Core:**
   - Never read or write `window.*` state.
   - Files inside `src/core/**` must have **ZERO** imports from `react`, DOM APIs, or `src/ui/**`.
   - Every canvas or Zettelkasten mutation executes through an undoable `CanvasCommand` in `src/core/commands/`.
2. **Synchronous Core Transactions (`CanvasCommand` & `SqlEnginePort`):**
   - *Reconciled v2 Contract (overrides `Promise<void>` pseudocode in `SPEC_rework_v2.md` §5.4):* `CanvasCommand.execute(db)` and `CanvasCommand.undo(db)` are **strictly synchronous** (`void`), executing inside `db.transaction(() => ...)` over `SqlEnginePort`.
   - This guarantees zero-race atomic undo/redo (`2-Finger Double-Tap` / `3-Finger Tap` / Radial Wheel) and deterministic `<500ms` headless Vitest execution (`node:sqlite` `DatabaseSync` in tests; in-memory `BrowserSqlEngine` with asynchronous background flush to IndexedDB/OPFS via `src/db/indexeddb_persistence.ts` or Web Worker adapters in production).
3. **Branded Unified World Coordinates & Page-on-Infinite-Canvas:**
   - Screen coordinates (`ScreenPoint`) and world coordinates (`WorldPoint`, `WorldAABB`) are nominally branded (`src/core/canvas/types.ts`). Conversions must pass through `screenToWorld` and `worldToScreen` in `src/core/canvas/math.ts`.
   - *Reconciled v2 Coordinate & Page-Binding Invariant:* All `spatial_nodes`, `canvas_pages`, and `spatial_nodes_rtree` entries store bounding boxes and stroke vertices in **Unified World Space** so a single viewport R-Tree query renders Page Frames, Dry Ink, PDF Snippets, `[[WikiLink]]` highlights, and Async Badges (`◌ 🔄 ● ⚛`) under one shared camera matrix `(panX, panY, zoom, rotation)` with **zero pan/zoom drift**.
   - `spatial_nodes.page_id` is **nullable (`PageId | null`)**:
     - **Single-Page Stroke:** `page_id` is set to the enclosing `canvas_pages.id`.
     - **Cross-Boundary Stroke (2+ Pages):** `page_id` anchors to the origin page where `PEN_DOWN` began, and all intersected `canvas_pages` are automatically bound into a Multi-Page Note via a shared `canvas_pages.page_group_id`.
     - **Open-Plane Scratch Ink:** Strokes drawn in infinite space outside any existing page frame have `page_id = null` until an ad-hoc scratchpad page is spawned or snapped around them.
4. **64-Bit R-Tree Key Invariant:**
   - `spatial_nodes.id` is a UUID (`NodeId`), while `spatial_nodes_rtree.id` is a 64-bit signed integer mapped to `spatial_nodes.rowid` via automatic SQLite triggers (`sync_rtree_insert`, `sync_rtree_update`, `sync_rtree_delete`). Never insert UUID strings directly into `spatial_nodes_rtree`.
5. **Zero-Allocation Wet-Ink Hot Loop (<4ms Pen-to-Pixel):**
   - During active stylus drawing (`PEN_DRAWING`), high-frequency pointer samples (`getCoalescedEvents()` + `getPredictedEvents()`) write into pre-allocated `Float32Array` slabs (`WetStrokeBuffer`, `[x, y, pressure, tiltX, tiltY, timestamp]`) rendered on a top-layer `desynchronized: true` overlay `<canvas>` (or Android Jetpack Ink / Vulkan SurfaceView).
   - Once `PEN_UP` commits via `CommitStrokeCommand` and the Unified Dry Scene Graph renders the committed frame, the wet overlay clears immediately with zero flicker.
6. **Runtime Zod Validation at All Boundaries:**
   - Every boundary (Bridge events, SQLite row parsing, Worker messages, and AI/Syntax tool calls in `src/ai/agent_contract.ts`) MUST be validated with a runtime Zod schema.

---

## 2. Module Map: Implemented Foundation & v2 Target Extensions

| Layer | Module Path | Status | Responsibility |
| :--- | :--- | :--- | :--- |
| **Core: Canvas Math** | `src/core/canvas/types.ts`<br>`src/core/canvas/math.ts` | Implemented *(Extend for v2)* | Branded IDs (`CanvasId`, `PageId`, `LayerId`, `NodeId`, `JobId`), `CameraStateSchema` (add `isZoomLocked`), `StrokeCommittedEventSchema` (add `pageId: PageId \| null`, `isClosedLoop`), Ramer-Douglas-Peucker simplification, polygon & AABB intersection, page-grid snapping math. |
| **Core: Syntax & Zettel** | `src/core/syntax/*`<br>`src/core/zettel/*` | Target v2 *(Pure extraction from `src/ai/`)* | Pure AST/token parsers for `[[WikiLink]]`, `#`/`##`/`###` headings, `[ ]` tasks, `@date`, `?` query glyphs, and structural diagram primitives (`-->`, `{ }`, `vs.`, loop-cycles `A → B → C → A`), plus intra-page `#` → `##` → `###` hierarchy builders. |
| **Core: Commands** | `src/core/commands/canvas_command.ts`<br>`src/core/commands/slice_erase_command.ts`<br>`src/core/commands/zettel_commands.ts`<br>`src/core/commands/math_and_media_commands.ts` | Implemented *(Extend for v2)* | Synchronous undoable `CanvasCommand` implementations (`CommitStrokeCommand`, `EraseNodesCommand` [default Samsung Notes whole-stroke eraser], `SliceEraseCommand` [toggleable partial trimmer], `MoveNodesCommand`, `ClusterStrokesCommand`, `DragToCiteCommand`, plus v2 `CommitAtomizationCommand`, `GroupByCircleCommand`, `ToggleTaskCommand`). |
| **DB & Persistence** | `src/db/schema.sql`<br>`src/db/engine_port.ts`<br>`src/db/client.ts`<br>`src/db/browser_sql_engine.ts`<br>`src/db/indexeddb_persistence.ts`<br>`src/db/repositories/*` | Implemented *(Extend for v2)* | `SqlEnginePort` abstraction, `NoteFlowDatabase`, R-Tree triggers, and repositories (`SpatialNodeRepository`, `AsyncJobRepository`, `ZettelRepository`, plus v2 `PageRepository` for `canvas_pages` & `ObjectStoreRepository` for `object_store_items`). |
| **AI & Intelligence** | `src/ai/tier0_clustering/stroke_clusterer.ts`<br>`src/ai/ink_recognition/recognition_port.ts`<br>`src/ai/ink_recognition/vector_topology_analyzer.ts`<br>`src/ai/zettel_sync/auto_zettel_syncer.ts`<br>`src/ai/agent_contract.ts` | Implemented *(Extend for v2 Tiers 1–4)* | 5-Stage Intelligence Hierarchy (see §3 below), `InkRecognitionPort`, `VectorTopologyAnalyzer`, `AutoZettelSyncer`, and Zod schemas (`HeadingAtomizationToolSchema`, `WikiLinkResolutionSchema`, `UpdateJobBadgeToolSchema`, `CreateZettelCardToolSchema`). |
| **State & FSM** | `src/state/gesture_fsm.ts`<br>`src/state/async_job_queue.ts`<br>`src/state/canvas_store.ts` | Implemented *(Extend for v2)* | Bimanual S-Pen & Touch Gesture FSM (Main Canvas + Side-Drawer), `AsyncJobQueue` with `AbortController` per job, and `CanvasStore` projecting `UnifiedSceneFrame` (Page Frames + Layer-Interleaved Nodes + `[[WikiLink]]` glows + Async Badges `◌ 🔄 ● ⚛`). |
| **UI & Scene Graph** | `src/ui/scene_graph/*`<br>`src/ui/tablet_app.ts`<br>`src/ui/wheel/*` *(v2)*<br>`src/ui/drawer/*` *(v2)*<br>`src/ui/popovers/*` *(v2)*<br>`src/ui/layers/*` *(v2)* | Implemented & Target v2 | `WetStrokeBuffer`, `TabletPointerBridge`, `DualCanvasRenderer` (True Layer Interleaving by `z_index ASC`), 9-Slot Concepts Radial Wheel (with per-tool width/color memory & zoom lock), Left/Right Dockable Research Drawer (PDF Reader, AI Chat, Object Store/Vault/Agenda), and `[[WikiLink]]` Cobalt Peek / Crimson Disambiguation & `⚛` Atomize popovers. |

---

## 3. Reconciled 5-Stage Intelligence & Syntax Pipeline

*Reconciled v2 Pipeline (resolving the `SPEC_rework_v2.md` §1.3/§7 vs. §4 tension):* Handwritten syntax and diagram topology (`-->`, `{ }`, `vs.`, loop-cycles) are solved **deterministically in Tier 0/1 (`<50ms`)** via `InkRecognitionPort` (`VectorTopologyAnalyzer`) and pure syntax/zettel rules so offline note-taking and headless tests work instantaneously at zero cost. Tier 3 Edge VLM acts strictly as an optional semantic fallback/refiner for complex freeform diagrams.

1. **Tier 0: Spatio-Temporal Clustering & Fast Geometric Gestures (`<3ms`, `src/ai/tier0_clustering/`):**
   - **Single-Stroke Fast Path:** Immediately checks `isClosedLoop` on `PEN_UP`:
     - *Closed Circle + Hold (`>= circleLassoHoldMs`, default 300ms):* Enters ephemeral `LASSO_ACTIVE_AWAITING_GLYPH`.
     - *Closed Circle + Immediate Lift (`CLOSED_CIRCLE_GROUP`):* Keeps the visible circle stroke and groups enclosed strokes via `GroupByCircleCommand`.
     - *`?` Glyph inside/near Active Lasso:* Immediately enqueues a `lasso_question_search` job (`◌ → 🔄 → ●`).
   - **Spatio-Temporal Merge:** Debounces `1200ms` after pen pause, merging strokes on the same page/layer within `Δx < 48px, Δy < 24px` into a `stroke_cluster`.
2. **Tier 1: Local OCR, Syntax AST & Deterministic Vector Topology Solver (`<50ms`, `src/ai/ink_recognition/` + `src/core/syntax/`):**
   - Runs local OCR (MLKit Digital Ink / `InkRecognitionPort`) + `VectorTopologyAnalyzer` on dirty `stroke_cluster` nodes (supports both `parseMode: "auto"` and 1-click manual parse):
     - **`[[Note Name]]` (WikiLink Syntax):** Queries `ZettelRepository` for exact/fuzzy title match. Exact match sets `wikilink_state = 'resolved'` (**Cobalt Blue** glow, opens non-jarring Peek Popover on tap) and creates a bidirectional `wikilink` tether; missing or ambiguous match sets `wikilink_state = 'ambiguous_or_missing'` (**Crimson Red** `#DC2626` glow, opens candidate dropdown + `+ Create Empty Zettel & Jump` on tap).
     - **`#`, `##`, `###` (Hierarchical Auto-Atomization):** Flags cluster `heading_level` (`1 | 2 | 3`), builds intra-page parent/child hierarchy (`parent_of` / `child_of`), scopes body clusters via column-flow and connectors, and respects `settings_json.atomizationMode`:
       - `confirm_on_tap` (default): Anchors a passive `⚛` (`propose_atomization`) badge to confirm titles and execute `CommitAtomizationCommand`.
       - `auto_atomize`: Automatically executes `CommitAtomizationCommand`.
       - In both modes, original handwritten ink remains **non-destructively anchored** on the canvas page.
     - **Handwritten Structural Symbols to Markdown & Graph Links:** Compiles drawn arrows (`-->` into causal `causes` links and chains), curly-brace groups (`{ }` into nested lists), comparison tables (`vs.` into Markdown tables), and directed cycles (`A → B → C → A` into `↻ Cycle` blocks) inside `summary_markdown`.
     - **`[ ]` and `@date`:** Extracts bidirectional `agenda_task` nodes (`task_completed: 0 | 1`) into the Vault Agenda View.
3. **Tier 2: Local Embeddings & Fuzzy Link Resolution (`<100ms`, `src/ai/tier2_embeddings/`):**
   - Runs when cluster text shifts by `>= 10` characters or a new `#` section is created.
   - Computes 384-dim `all-MiniLM-L6-v2` embeddings stored in `zettels.embedding` (`F32_BLOB(384)`), powering fuzzy candidate ranking for Crimson `[[WikiLink]]` disambiguation and `sqlite-vec` cosine similarity (`> 0.82`) Ghost Links.
4. **Tier 3: Edge/Device VLM Refiner (`1–2s`, `src/ai/tier3_edge_vlm/`):**
   - Optional local vision fallback (Gemini Nano / Edge VLM) when complex multi-column layouts or ambiguous freeform diagrams cannot be resolved purely by Tier 1 vector topology.
5. **Tier 4: Cloud Multimodal Agent (`src/ai/tier4_cloud/` + `src/ai/agent_contract.ts`):**
   - Invoked **ONLY on explicit user trigger**: Rainbow AI Highlighter (`violet`), Lasso + `?` glyph, `1-Finger Hold + S-Pen AI Lasso`, accepting `⚛` Atomization with cloud synthesis, or Side-Drawer AI Chat.
   - Emits Zod-validated tool calls (`HeadingAtomizationToolSchema`, `WikiLinkResolutionSchema`, `UpdateJobBadgeToolSchema`) and links completed `● Ready` badges to `drawer_chat_thread_id`.

---

## 4. Reconciled Bimanual S-Pen & Touch Gesture FSM Contract

*Reconciled v2 FSM (`src/state/gesture_fsm.ts`, resolving gaps in `SPEC_rework_v2.md` §2.1, §2.2, and §5.3):*
1. **Strict Hardware Separation:** `event.pointerType === 'pen'` (S-Pen) vs. `'touch'` (Finger) across both the **Main Canvas** and the **Left/Right Dockable Side-Drawer**.
2. **OS Palm-Rejection Cancellation Safety:** Every active touch or pen state MUST handle `TOUCH_CANCEL` and `PEN_CANCEL` (fired when OS palm rejection preempts touch streams as the S-Pen approaches the digitizer), cleanly rolling back ephemeral state to `IDLE` (or `TOUCH_HOLD_MODIFIER` when only pen is cancelled during bimanual hold).
3. **Complete 9-Slot Radial Wheel & Eraser Sub-Mode Routing:**
   - Drawing tools (`pen`, `secondary_pen`, `marker`, `highlighter`) transition `IDLE -> PEN_DRAWING` and maintain independent per-tool stroke-width (`Fine 1.2px`, `Medium 2.8px`, `Thick 6.0px` or custom) and color memory.
   - Eraser slot defaults to Samsung Notes-style **Whole-Stroke Eraser** (`tool: 'stroke_eraser'` -> `PEN_STROKE_ERASING` -> `EraseNodesCommand`) and can be toggled to **Slice Eraser** (`tool: 'slice_eraser'` -> `PEN_SLICE_ERASING` -> `SliceEraseCommand`).
   - Dedicated Smart Picker / Magic Lasso slot (`tool: 'lasso'`) transitions `IDLE -> PEN_LASSOING -> LASSO_ACTIVE_AWAITING_GLYPH`.
   - Teaching Laser / Spotlight slot (`tool: 'laser'`) transitions `IDLE -> PEN_TEACHING_LASER`.
4. **Main Canvas 2-Finger Navigation & 1-Finger Hold Disambiguation:**
   - **Immediate 1-Finger Move (`<500ms`, `>8px` slop):** Palm-safe no-op (`TOUCH_1_PENDING -> IDLE`). Camera never pans with 1 finger.
   - **1-Finger Stationary Hold (`>=500ms`, `<=8px` slop):** Transitions `TOUCH_1_PENDING -> TOUCH_HOLD_MODIFIER`:
     - Dragging the held finger `>8px` transitions to `TOUCH_LASSOING -> LASSO_ACTIVE_AWAITING_GLYPH`.
     - Putting S-Pen down while holding 1 finger (`TOUCH_1_PENDING` or `TOUCH_HOLD_MODIFIER`) transitions to `TOUCH_HOLD_PEN_AI_LASSOING`, dispatching an `bimanual_ai_lasso` autoresearch job on `PEN_UP`.
   - **2-Finger Navigation & Hardware Shortcuts:**
     - `TOUCH_2_PENDING_TAP_OR_NAV`: `TWO_FINGER_DOUBLE_TAP` dispatches `CommandHistory.undo()` and returns to `IDLE`; moving `>8px` transitions to `TOUCH_2_NAVIGATING` (2-finger pan, pinch-zoom `10%–3200%` unless `camera.isZoomLocked === true`, and rotate snapping to `0°` within `±5°`).
     - `THREE_FINGER_TAP` dispatches `CommandHistory.redo()`.
     - `THREE_FINGER_SWIPE` toggles the Left/Right Split-Screen Research Drawer.
5. **Side-Drawer Bimanual Extraction (`target: 'DRAWER'`):**
   - Finger touch exclusively scrolls/zooms the PDF or AI Chat (`DRAWER_TOUCH_SCROLL_ZOOM`).
   - S-Pen exclusively performs Smart Select via freeform Lasso or Vertical Bracket `[` (`DRAWER_PEN_SMART_SELECTING -> DRAWER_SELECTION_READY`).
   - While in `DRAWER_SELECTION_READY`, the next touch or S-Pen down **inside** the selection drags it onto the Main Canvas (`DRAWER_SELECTION_DRAGGING_TO_CANVAS` -> executes `DragToCiteCommand` on the `Reference Layer` with immutable citation tether `{ pdf_id, page_number, bounding_box }`); touching **outside** deselects.

---

## 5. Upgradability & Extension Seams (Ports & Adapters)

1. **Database Engine Port (`src/db/engine_port.ts`):**
   - `NoteFlowDatabase` depends only on `SqlEnginePort`.
   - In Node/Vitest headless tests, it uses `node:sqlite` (`DatabaseSync`) initialized with `src/db/schema.sql`.
   - In Browser/Android WebView/Capacitor environments, it uses `BrowserSqlEngine` (`src/db/browser_sql_engine.ts`) with `IndexedDbPersistence` (`src/db/indexeddb_persistence.ts`) or a Web Worker OPFS SQLite WASM + `sqlite-vec` adapter without changing a single line in `src/db/repositories/*` or `src/core/commands/*`.
2. **Ink & Topology Recognition Port (`src/ai/ink_recognition/recognition_port.ts`):**
   - `AutoZettelSyncer` and Tier 1 syntax/topology pipelines depend on `InkRecognitionPort`.
   - Headless tests and offline deterministic mode use `VectorTopologyAnalyzer` (`src/ai/ink_recognition/vector_topology_analyzer.ts`), while Android tablets can inject a native MLKit Digital Ink + Gemini Nano adapter behind the same port.
3. **Adding a New Canvas or Zettelkasten Mutation:**
   - Implement synchronous `CanvasCommand` (`execute(db)` and `undo(db)` wrapped in `db.transaction(...)`) inside `src/core/commands/`.
   - Register a headless unit test in `tests/headless/` verifying bit-for-bit state and R-Tree restoration after `execute() -> undo() -> execute()`.
4. **Adding or Upgrading AI Tools (`src/ai/agent_contract.ts`):**
   - Define a strict Zod schema in `src/ai/agent_contract.ts` (`HeadingAtomizationToolSchema`, `WikiLinkResolutionSchema`, `UpdateJobBadgeToolSchema`, `CreateZettelCardToolSchema`).
   - Always check `AsyncJobQueue.getAbortSignal(jobId)` before committing tool results through a `CanvasCommand`.
