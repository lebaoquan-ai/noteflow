# NoteFlow — Progress Update #1 & Collaborator Onboarding Guide

**Date:** October 26, 2026  
**Status:** Phases 0–3 Core Engine + Phase 4A Engine Hardening + Phase 4B Interactive Tablet HUD Overlays + Phase 4C Critical Review Remediation Complete  
**Verification Gate:** `npm run typecheck` (0 errors) • `npm run test:headless` (13 test suites, 64/64 tests passing in ~800ms) • `npm run build` (clean ~36.9 kB gzipped bundle)

Welcome to **NoteFlow**! This document summarizes everything built so far, explains how the architecture works under the hood, and gives you a clear roadmap to navigate, extend, and collaborate on the codebase.

---

## 1. What is NoteFlow?

**NoteFlow** is a **Stylus-First, AI-Native Spatial Zettelkasten** designed for tablets (iPadOS / Android Tablets / Touch-Stylus laptops).  
Unlike traditional note apps where AI is bolted on as a blocking chat sidebar, NoteFlow treats **handwriting, spatial layout, and ink color** as ambient instructions to a background multi-tier intelligence pipeline:

1. **Zero-Latency Ink (<4ms):** You write freely at 120Hz. AI never hijacks your pen or blocks the UI thread.
2. **Semantic Ink Triggers (`Violet AI Highlighter`):** Highlighting handwritten claims or equations in **Violet** (or circling them with the **Magic Lasso**) immediately groups the strokes via Spatial Union-Find and spawns a non-blocking status badge (`◌` Queued → `↻` Running → `●` Verified) anchored directly to the ink cluster's bounding box.
3. **Spatial Zettelkasten & Teaching Mode:** Verified notes synthesize into atomic **Zettel Cards** with 768-dim vector embeddings, automatic **Ghost Link** discovery, **PDF Split-Screen Citations**, and a 1-tap **Teaching Mode** that hides private scratchpad/AI hints when presenting or exporting lecture SVG artboards.

---

## 2. Quickstart: Running & Testing the Project

### Prerequisites
- **Node.js:** `v22.5+` or `v26+` (uses built-in `node:sqlite` for sub-second headless SQLite R-Tree testing).
- **npm:** `v10+`

### Key Commands
```bash
# 1. Install dependencies
npm install

# 2. Run strict TypeScript compiler check (must always be 0 errors)
npm run typecheck

# 3. Run the 60 headless unit & property-based tests (~880ms, no browser required)
npm run test:headless

# 4. Launch the interactive Proof-of-Concept Tablet Server (accessible over Wi-Fi LAN)
npm run dev

# 5. Build production bundle into dist/
npm run build
```

### Testing on a Real Tablet (iPad / Android Tablet)
When you run `npm run dev`, Vite prints a `Network:` URL (e.g., `http://192.168.1.x:5173/`). Open that URL on your tablet in Safari or Chrome to test:
- **Stylus / Mouse Drawing:** Sub-4ms desynchronized wet-ink rendering with quadratic Bezier pressure smoothing and predicted tip look-ahead.
- **✨ AI Violet Tool:** Draw over or near any stroke with the Violet Highlighter to watch the live `◌ → ↻ → ●` AI verification badge lifecycle.
- **Bimanual Touch Gestures:**
  - **1-Finger Drag:** Pan the infinite canvas (badges and cards move in 100% lockstep with zero lag/drift).
  - **2-Finger Pinch:** Zoom around the pinch focal point (`0.1x` – `10.0x`).
  - **2-Finger Tap:** Instant Undo.
  - **3-Finger Tap:** Instant Redo.
  - **1-Finger Hold (220ms):** Summons the **Floating 6-Slot Radial Tool Wheel** centered at your finger's hold coordinates (`TOUCH_HOLD_MODIFIER`), or drag with the stylus while holding to trigger **Bimanual Magic Lasso** (`TOUCH_HOLD_PEN_LASSOING`) without switching tools.
- **● / ↻ Clickable AI Status Badges:** Tap any `◌ / ↻ / ●` status badge anchored to a stroke cluster to open the **AI Badge Inspection Popover** (showing verification state, tooltip message, and a 1-tap **⚛ Synthesize Linked Zettel Card** button that executes an undoable `CreateZettelCardCommand`).
- **✂️ Slice Eraser:** Drag across existing strokes to mathematically split intersected polylines into sub-strokes (and hit Undo to restore the original unbroken stroke).
- **🎓 Teaching Mode + 📤 Export SVG:** Toggle Teaching Mode in the top bar to hide Layer 2 (`Scratchpad`) and Layer 3 (`AI Verify`), then click **Export SVG** to download a clean lecture handout.

---

## 3. Summary of Progress (Core Engine Complete vs. Production Integrations Pending)

| Phase | Milestone Scope (`docs/SPEC.md` §7) | Core Engine & Commands | Production UI / AI Integration | Key Modules & Verification Tests |
| :--- | :--- | :---: | :---: | :--- |
| **Phase 0** | **Ink Foundation & Product Kernel:** Branded 2D math, Bimanual Gesture FSM, SQLite R-Tree schema & triggers, `<4ms` Wet/Dry Scene Graph, Tier-0 Spatial Union-Find Clustering (with incremental cluster merging), `◌ → ↻ → ●` Async Badge loop | ✅ **Done** | ✅ **Live in Tablet PoC** (Simulated timer worker) | `gesture_fsm.ts`, `math.ts`, `schema.sql`, `wet_ink_buffer.ts`, `stroke_clusterer.ts`, `async_job_queue.ts` |
| **Phase 1** | **Core Note-Taking, Smart Layers, Lasso & Zettelkasten:** 4 Smart Layers (`z_index` ordering, `isLocked`, `opacity`), Ray-casting Freehand Lasso, undoable Circle-to-Action (`ClusterStrokesCommand`), coalesced `SliceEraseCommand`, Atomic Zettel Cards + 768-dim cosine search | ✅ **Done** | ✅ **Done (Phase 4B):** Floating 6-slot radial wheel at touch hold point & AI badge inspect popovers (`⏳ Pending`: `[ ]` / `@date` task agenda UI) | `canvas_store.ts`, `slice_erase_command.ts`, `zettel_repository.ts`, `zettel_commands.ts`, `tablet_app.ts` |
| **Phase 2** | **Handwritten Math & Split-Screen PDF Citations:** `CompileMathBlockCommand` (dual handwritten/typeset LaTeX nodes) and `DragToCiteCommand` (provenance-linked PDF excerpts) | ✅ **Done** | ⏳ **Pending:** Embedded `pdf.js` split-screen drawer, KaTeX DOM/SVG math renderer, Tier 1–3 ONNX/VLM workers | `math_and_media_commands.ts` |
| **Phase 3** | **Zettel Graph, Ghost Links, Teaching Mode & Artboard Export:** Semantic Ghost Link discovery (`discoverGhostLinks`), undoable `LinkZettelsCommand`, 1-tap Teaching Mode filter, SVG Artboard Exporter, and Tablet PoC UI | ✅ **Done** | ⏳ **Pending:** Interactive Socratic Atomizer popover dialogue & Ghost Link accept/dismiss UI | `artboard_exporter.ts`, `pointer_bridge.ts`, `canvas_renderer.ts`, `tablet_app.ts`, `code_review_violations.test.ts` |

---

## 4. Codebase Architecture & Navigation Map

To keep the codebase clean, readable, and testable in `<500ms` without a browser, **NoteFlow** enforces a strict **one-way Layered Dependency DAG**:

```text
src/core/canvas/*      (Layer 1: Pure 2D Math, Branded Types, Zod Schemas — ZERO external deps)
       ▲
src/db/*               (Layer 2: SqlEnginePort, SQLite R-Tree Schema, Repositories)
       ▲
src/core/commands/*    (Layer 3: Atomic Undoable CanvasCommands — Commit, Move, Erase, Slice, Zettel, Math, Cite)
       ▲
src/ai/* & src/state/* (Layer 4: Bimanual Gesture FSM, Tier-0 Clusterer, AsyncJobQueue, CanvasStore)
       ▲
src/ui/*               (Layer 5: WetStrokeBuffer, TabletPointerBridge, DualCanvasRenderer, SVG Exporter, Tablet App)
```

### Directory Breakdown

```text
noteflow/
├── AGENTS.md                        # Strict architectural rules & verification gates
├── index.html                       # Tablet Proof-of-Concept HTML shell & glassmorphic CSS
├── vite.config.ts                   # Vite bundler config with COOP/COEP headers
├── vitest.config.ts                 # Headless Vitest configuration
├── docs/
│   ├── SPEC.md                      # Master Product & System Architecture Specification
│   ├── ARCHITECTURE.md              # Layer dependency DAG & extension seams
│   ├── repo-map.json                # Machine-readable module & test mapping
│   ├── progress-update-1.md         # This onboarding & progress guide
│   ├── phase4ab-implementation-plan.md # Phase 4A/4B Technical Implementation Plan
│   └── phase4ab-walkthrough.md      # Phase 4A/4B Verification & Walkthrough Report
├── .agents/skills/                  # 6 Domain Engineering Playbooks (TDD, R-Tree, Math, Ink, Simulator, Debugging)
├── src/
│   ├── core/
│   │   ├── canvas/
│   │   │   ├── types.ts             # Branded types (ScreenPoint, WorldPoint, WorldAABB, NodeId) & Zod schemas
│   │   │   └── math.ts              # Camera affine projections, zoomAroundPoint, RDP decimation, ray-casting
│   │   └── commands/
│   │       ├── canvas_command.ts    # CanvasCommand interface, CommandHistory, Commit/Move/Erase commands
│   │       ├── slice_erase_command.ts # Vector polyline intersection & stroke-splitting eraser command
│   │       ├── zettel_commands.ts   # CreateZettelCardCommand & LinkZettelsCommand
│   │       └── math_and_media_commands.ts # CompileMathBlockCommand & DragToCiteCommand
│   ├── db/
│   │   ├── schema.sql               # SQLite DDL: canvases, layers, spatial_nodes, spatial_nodes_rtree, async_jobs, zettels
│   │   ├── engine_port.ts           # Portable SqlEnginePort interface
│   │   ├── client.ts                # NoteFlowDatabase (loads node:sqlite in Node/Vitest, BrowserSqlEngine in Web)
│   │   ├── browser_sql_engine.ts    # Zero-dependency browser SQL + R-Tree + Trigger engine
│   │   └── repositories/
│   │       ├── spatial_node_repository.ts # CRUD & R-Tree viewport culling queries (JOIN on rowid)
│   │       ├── async_job_repository.ts    # Dynamic badge projection JOINs on anchor_node_id
│   │       └── zettel_repository.ts       # Zettels, knowledge graph links, 768-dim cosine search, Ghost Links
│   ├── ai/
│   │   ├── agent_contract.ts        # Zod schemas for AI tool calls (CreateZettelCardToolSchema, UpdateJobBadgeToolSchema)
│   │   └── tier0_clustering/
│   │       └── stroke_clusterer.ts  # 1200ms debounced / 0ms Violet spatial Union-Find stroke clustering
│   ├── state/
│   │   ├── gesture_fsm.ts           # Pure Bimanual Gesture State Machine (palm rejection, 8px slop, hold+pen lasso)
│   │   ├── async_job_queue.ts       # Job lifecycle & AbortController cancellation on Undo/Erase
│   │   └── canvas_store.ts          # Central facade coordinating camera, Smart Layers, R-Tree scene frames, & commands
│   └── ui/
│       ├── tablet_app.ts            # Interactive Tablet Proof-of-Concept controller & DOM bindings
│       └── scene_graph/
│           ├── wet_ink_buffer.ts    # Pre-allocated Float32Array slab for zero-GC 120Hz/240Hz pointer ingestion
│           ├── pointer_bridge.ts    # Connects PointerEvents (coalesced/predicted) to gesture_fsm & CanvasStore
│           ├── canvas_renderer.ts   # Dual-<canvas> renderer (desynchronized wet overlay + unified dry scene graph)
│           └── artboard_exporter.ts # Phase 3 vector SVG Artboard exporter (respects Teaching Mode)
└── tests/headless/                  # 13 fast headless test suites (60 tests total)
```

---

## 5. Five Core Architectural Invariants Every Collaborator Must Know

Before modifying code, keep these 5 rules in mind (enforced by `AGENTS.md` and `tests/headless/`):

### 1. Pure Core (`src/core/**` has ZERO DOM/UI imports)
Files in `src/core/**` must never import `window`, `document`, `HTMLCanvasElement`, React, or `src/ui/**`. This guarantees that all geometry, spatial math, and undo/redo commands run in `<450ms` inside Node/Vitest.

### 2. Branded Coordinate Safety (`ScreenPoint` vs. `WorldPoint`)
Never pass raw `{ x, y }` numbers between screen and world functions. Use the branded constructors `screenPoint(x, y)`, `worldPoint(x, y)`, and `worldAABB(minX, minY, maxX, maxY)` from `src/core/canvas/types.ts`, and convert strictly via `screenToWorld(pt, camera)` and `worldToScreen(pt, camera)`.

### 3. The SQLite R-Tree `rowid` Invariant
SQLite's `rtree` virtual table requires 64-bit integer primary keys (`id`), whereas application nodes use UUID strings (`NodeId`).
- `spatial_nodes` uses `id TEXT PRIMARY KEY` (UUID) and its implicit 64-bit integer `rowid`.
- Three SQL triggers (`sync_rtree_insert`, `sync_rtree_update`, `sync_rtree_delete`) automatically synchronize `spatial_nodes.rowid` with `spatial_nodes_rtree.id`.
- **Never** manually `INSERT` or `UPDATE` `spatial_nodes_rtree` in application code—always mutate `spatial_nodes` and query the R-Tree via `INNER JOIN spatial_nodes_rtree r ON n.rowid = r.id`.

### 4. Every Canvas Mutation is an Undoable `CanvasCommand`
Never mutate spatial nodes directly from UI event handlers. Every canvas change must implement `CanvasCommand` (`execute()` and `undo()` wrapped in `this.db.transaction(...)`) and run through `store.history.execute(cmd)`.
- When `store.history.undo()` is called on an erased or modified stroke cluster, `CommandHistory` automatically notifies `AsyncJobQueue` to fire `AbortController.abort()` on any in-flight AI jobs anchored to those nodes so zombie AI badges never appear on undone ink!

### 5. Dual-`<canvas>` Wet/Dry Pipeline (`<4ms` Ink + Zero Badge Drift)
- **Top `<canvas>` (`#wet-canvas`):** Initialized with `getContext('2d', { desynchronized: true })`. Renders only the currently active stylus stroke from the pre-allocated `WetStrokeBuffer` (`Float32Array`) in screen space.
- **Bottom `<canvas>` (`#dry-canvas`):** Renders the `UnifiedSceneFrame` built by `CanvasStore.buildSceneFrame()`. Because dry strokes, Zettel cards, and `◌ / ↻ / ●` status badges are projected through the **exact same `CameraState` snapshot** in a single `requestAnimationFrame` pass, badges never "swim" or lag behind handwritten ink during 120Hz pan/zoom.

---

## 6. How to Add a New Feature (Collaborator Workflow)

We follow **Headless-First Vertical-Slice TDD** (`.agents/skills/vertical-slice-tdd/SKILL.md`):

1. **Define Schema / Types First:** Add or update Zod schemas in `src/core/canvas/types.ts` or `src/ai/agent_contract.ts`.
2. **Write a Failing Headless Test (`Red`):** Create or extend a test in `tests/headless/*.test.ts`.
3. **Implement Pure Logic / Command (`Green`):** Implement the repository query in `src/db/repositories/` or `CanvasCommand` in `src/core/commands/`.
4. **Wire into `CanvasStore` & UI (`Refactor`):** Expose the action on `CanvasStore` (`src/state/canvas_store.ts`) and render/bind it in `src/ui/scene_graph/canvas_renderer.ts` and `src/ui/tablet_app.ts`.
5. **Run the Verification Gate:**
   ```bash
   npm run typecheck && npm run test:headless && npm run build
   ```

---

## 7. Next Steps & Collaboration Backlog (Phase 4 & Production)

Here are the highest-leverage areas where a newcomer can jump right in:

1. **Web Worker OPFS Persistence Adapter (`src/db/worker_opfs_engine.ts`):**
   - Implement `SqlEnginePort` backed by `@sqlite.org/sqlite-wasm` OPFS inside a dedicated Web Worker so tablet notes persist across browser reloads while keeping the main-thread `BrowserSqlEngine` as a synchronous hot cache.
2. **Real Local AI / Cloud Worker Integration (`src/ai/workers/`):**
   - Connect `AsyncJobQueue` (`cluster_ocr`, `verify_claim`, `compile_latex`, `synthesize_zettel`) to an ONNX Runtime Web / WebGPU OCR worker and LLM API endpoint using the validated Zod tool contracts in `src/ai/agent_contract.ts`.
3. **Interactive Split-Screen PDF Reader Drawer (`src/ui/pdf_drawer/`):**
   - Embed `pdf.js` in a collapsible left/right split drawer so users can select real PDF paragraphs/figures and drag them onto the canvas via `DragToCiteCommand`.
---

## 8. Architectural Decisions & Answers to Newcomer Review Questions

### Q1. UI & Renderer Stack: Vanilla TS + Canvas2D vs. React 19 + WebGL2/Skia?
- **Decision:** Keep the **hot wet/dry canvas rendering pipeline (`WetStrokeBuffer`, `TabletPointerBridge`, `DualCanvasRenderer`) in zero-allocation Vanilla TypeScript + Canvas2D** (with `OffscreenCanvas` tile caching in Phase 4), and introduce **lightweight UI components (or React 19 overlays)** strictly for **non-canvas chrome & floating HUDs** (the radial tool wheel at the touch hold coordinate, badge verification popovers, Socratic Atomizer dialogues, and the `pdf.js` split-screen reader drawer).
- **Why:** High-frequency 120Hz/240Hz stylus input (`getCoalescedEvents` / `getPredictedEvents`) must never wait on React reconciliation. Keeping the canvas scene graph in pure TypeScript guarantees `<4ms` wet-ink latency while letting HUD overlays evolve independently.

### Q2. Source of Truth on Schema & Contracts (`schema.sql` & `agent_contract.ts` vs. `SPEC.md`)?
- **Decision:** **`src/db/schema.sql` and `src/ai/agent_contract.ts` are the canonical source of truth.**
- **Why:**
  1. Using `semantic_tags_json` (`JSON string[]`) on `spatial_nodes` allows a single `stroke_cluster` to carry multiple semantic tags (`["noir", "violet"]`) when a user highlights existing noir notes with a violet stroke, whereas a single `semantic_tag TEXT` column could only represent one tag.
  2. Using `status: 'completed' | 'failed'` + `badgeState: 'verified' | 'conflict' | 'hint_available'` + `tooltipMessage` on `UpdateJobBadgeToolSchema` cleanly separates the **job execution state** (`queued` → `running` → `completed | failed`) from the **epistemic verification outcome** (`verified | conflict | hint_available`).

### Q3. Synchronous `SqlEnginePort` vs. Web Worker OPFS SQLite?
- **Decision:** **Option A (Write-Behind Dual Engine)** — keep the synchronous main-thread `BrowserSqlEngine` (now backed by `SpatialGridIndex` and full transaction/savepoint rollback snapshots) as the **Main-Thread Hot Spatial Cache** for instant 0ms hit-testing (`pointermove` Slice Eraser, Lasso, and 120fps `buildSceneFrame`), and mirror committed transactions asynchronously to a Web Worker running `@sqlite.org/sqlite-wasm` + OPFS for durable disk persistence and heavy background queries.
- **Why:** As documented in `.agents/skills/spatial-rtree-sqlite/SKILL.md`, awaiting an asynchronous Worker `postMessage` round-trip inside a 120Hz `pointermove` or `requestAnimationFrame` loop causes frame drops and race conditions. Dual-engine write-behind gives us both 0ms synchronous spatial reads on the UI thread and durable SQLite OPFS storage in the Worker.

### Q4. Incremental Stroke Clustering Strategy?
- **Decision:** **Incremental Cluster Merging + Automatic Parent Cluster Pruning & Disconnection Partitioning on Undo/Erase** (implemented in `Tier0StrokeClusterer`, `ClusterStrokesCommand`, `CommitStrokeCommand`, `EraseNodesCommand`, and `SliceEraseCommand`).
- **How it works now:**
  1. `Tier0StrokeClusterer.clusterLayerNow()` loads both unclustered strokes (`getUnclusteredStrokesInLayer`) AND existing clusters (`getClustersInLayer`) and runs Union-Find over both using `areBoxesSpatiallyProximate` (`CLUSTER_MAX_GAP_X = 48`, `CLUSTER_MAX_GAP_Y = 24`).
  2. If new strokes are proximate to an existing `stroke_cluster`, they merge into that cluster via `ClusterStrokesCommand` (expanding its AABB, updating `strokeCount` and `semanticTags`, merging any bridged clusters, and superseding/cancelling stale badge jobs before enqueuing a fresh `verify_claim` badge).
  3. When any stroke is undone (`CommitStrokeCommand.undo()`), erased (`EraseNodesCommand`), or sliced (`SliceEraseCommand`), `SpatialNodeRepository.pruneOrUpdateParentClusters()` automatically deletes any `stroke_cluster` that has 0 remaining child strokes, shrinks its AABB to fit remaining strokes, and partitions disconnected stroke components (`> 48px` apart) back into separate `stroke_cluster` nodes with full Undo/Redo symmetry.

### Q5. Where Should We Start Together?
Our recommended priority order for upcoming collaboration:
1. **Track 1 (Interactive HUD Overlays) — ✅ COMPLETE (Phase 4A & 4B):**
   - Floating 6-slot Radial Tool Wheel at the 1-finger hold coordinate (`TOUCH_HOLD_MODIFIER`) and clickable `● / ↻` AI Badge Inspection Popovers with 1-tap undoable Zettel Card synthesis (`CreateZettelCardCommand`). See [`docs/phase4ab-walkthrough.md`](./phase4ab-walkthrough.md).
2. **Track 2 (Storage — Next Up):** Web Worker OPFS Write-Behind Bridge (`src/db/worker_opfs_bridge.ts`) so canvas sessions persist across tablet browser reloads.
3. **Track 3 (AI & PDF — Next Up):** Web Worker Tier-1 OCR / Tier-3 VLM integration and the collapsible `pdf.js` Split-Screen Reader Drawer wired to `DragToCiteCommand`.
