# NoteFlow: Engineering Handover Specification & Architecture

**Document Version:** 2.1 (Patched & Verified for Agentic Execution)  
**Target Systems:** iPadOS (Apple Pencil) & Android Tablet (S-Pen)  
**Primary Paradigm:** Stylus-First, AI-Native Spatial Zettelkasten  
**Primary Audience:** Human Systems Architects & Autonomous AI Coding Agents  

---

## 1. Executive Summary & Product Vision

### 1.1 The Core Problem
Knowledge workers and deep thinkers on tablets suffer from the **"Split-Screen Tax"**:
* **Handwriting/Drawing Apps** (*Concepts, Goodnotes, Samsung Notes*) offer fluid ink and spatial freedom but act as dead-pixel silos with zero semantic knowledge graphs.
* **PKM & AI Research Tools** (*Obsidian, Heptabase, NotebookLM*) offer atomic notes, graph linkage, and source-grounded synthesis, but are strictly keyboard/text-block-centric.
* Moving between handwriting and synthesis requires constant copying, context switching, and fragmented attention.

```
+------------------------------------+       +------------------------------------+
|       HANDWRITING SILOS            |       |        KNOWLEDGE SILOS             |
| (Concepts, Goodnotes, Samsung N.)  |       |  (Obsidian, Heptabase, NotebookLM) |
| • Fluid 120Hz ink & spatial canvas |  vs.  | • Atomic notes & graph connections |
| • Dumb vector/raster storage       |       | • Source-grounded AI synthesis     |
| • ZERO semantic knowledge graph    |       | • NO stylus/handwriting support    |
+------------------------------------+       +------------------------------------+
                  \                             /
                   \--- [ SPLIT-SCREEN TAX ] --/
                                  |
                                  v
                    +---------------------------+
                    |         NOTEFLOW          |
                    | Stylus-First, AI-Native   |
                    |    Spatial Zettelkasten   |
                    +---------------------------+
```

### 1.2 NoteFlow Solution
NoteFlow merges the ergonomic elegance of **Concepts App** (radial tool wheel, bimanual gestures, vector canvas, smart layers, object store) with an unobtrusive **Local-First Asynchronous AI Agent** and a **Spatial Zettelkasten Graph**.

### 1.3 The Three Core Modes
1. **Brainstorm & Plan (Divergent Mode):** Infinite vector canvas, fluid ink, task markers `[ ]`, and dates `@date` with zero keyboard dependency.
2. **Read & Learn (Absorptive Mode):** Side-panel PDF/Web reader, liquid drag-and-drop snippet extraction with indestructible citation tethers, non-blocking claim verification via semantic ink highlights.
3. **Synthesize & Teach (Convergent Mode):** Socratic distillation of messy ink into permanent atomic Zettels, presentation layer toggle, and laser-pointer teaching.

### 1.4 The Product Kernel (The 80/20 Test Loop)
The singular interaction loop that must feel magical before building secondary features:
```
[Write Claim by Hand] 
        │
        ▼
[Violet Highlight / Lasso] 
        │
        ▼ (Non-blocking queue: ◌ Queued → 🔄 Running)
[Continue Writing Elsewhere] 
        │
        ▼ (Worker searches/verifies in background)
[Badge Glows: ● Ready] 
        │
        ▼ (Tap badge whenever ready)
[Inspect Card / Drag Verified Fact or Chart onto Canvas]
```

---

## 2. Core Functional & UI/UX Specifications

### 2.1 The Dockable Radial Tool Wheel
Operable by the non-dominant thumb or stylus tap. Dockable to left, right, or floating.

```
       [ 5. Vector Eraser ]       [ 6. Teaching Laser ]
                 \                     /
    [ 4. Lasso / Picker ] --- ( WHEEL ) --- [ 1. Fine Pen ]
                 /                     \
       [ 3. Violet AI ]           [ 2. Sketch Marker ]
```

* **6 Outer Tool Slots:**
  1. `Fine Pen`: Pressure-sensitive vector handwriting.
  2. `Sketch Marker`: Semi-transparent chisel for diagram containers, headers.
  3. `Violet AI Highlighter`: Renders underneath ink; automatically triggers background fact-check/research job on the intersected stroke cluster.
  4. `Smart Picker / Magic Lasso`: Context menu (`Move/Scale`, `? Verify`, `✦ Explore`, `📊 Graph`, `⚛ Atomize`).
  5. `Vector Eraser`: Toggle between *Stroke Eraser* and *Slice Eraser*.
  6. `Teaching Laser / Spotlight`: Disappearing ink + background canvas dimmer.
* **Inner Ring (Semantic Palette & Stroke Width):**
  * Stroke widths: `Fine` (1.2px), `Medium` (2.8px), `Thick` (6.0px).
  * 6 Semantic Colors:
    * `Ink Noir / White` (Default writing)
    * `Cobalt Blue` (Annotations & secondary notes)
    * `Crimson Red` (Critique, questions, doubts)
    * `Forest Green` (Evidence & verified facts)
    * `Amber Gold` (Key takeaways / summaries)
    * `Violet AI` (Asynchronous AI trigger)

### 2.2 Bimanual Touch & Stylus Hardware Separation
Hardware events must strictly enforce `event.pointerType === 'pen'` vs. `'touch'`:

* **V1 Core Gestures (Minimal & Discoverable):**
  * `1-Finger Drag (>8px slop)`: Pan canvas (with strict palm rejection when pen is near/hovering).
  * `2-Finger Pinch / Rotate`: Zoom (10% to 3200%) and rotate (snaps to 0° within ±5°).
  * `2-Finger Tap`: Undo.
  * `3-Finger Tap`: Redo.
* **Progressive Power Gestures (Coached as user matures):**
  * `1-Finger Stationary Hold (<=8px slop) + Stylus Circle`: Instant Magic Lasso without switching tool on wheel.
  * `1-Finger Stationary Hold + Speak`: Scoped Push-to-Talk voice prompt targeting the hovered/circled object.
  * `3-Finger Swipe Left/Right`: Toggle the Split-Screen Drawer.

### 2.3 Canvas System & Smart Layers
* **Hybrid Plane:** Infinite zoomable 2D plane with configurable dot/grid background + optional Page/Artboard frames (A4, 16:9 slides).
* **Layer Pill Stack:**
  * `Presentation Layer`: Clean diagrams, finalized cards, slides (visible during teaching mode).
  * `AI Layer`: AI-generated graphs, ghost links, synthesis cards.
  * `Draft Ink Layer`: Default user handwriting and sketches.
  * `Reference Layer`: PDF clippings, web screenshots, raw quotes.
* **Teaching Mode Toggle:** Single tap hides `Draft` and `Reference` layers, spotlighting only `Presentation`.

### 2.4 Split-Screen Research Drawer, Liquid Extraction & Object Vault
* Drawer coexists seamlessly with canvas (resizable 30% / 50% / hidden) and features 3 tabs:
  1. **Source Reader Tab (`PDF.js` Worker):** Houses PDFs and web clippings. Supports **Liquid Extraction**: highlighting PDF text or dragging a selection box across a diagram lets the user pull it directly onto the canvas as a spatial node with an immutable **Citation Tether** (`pdf_id`, `page_number`, `bounding_box`).
  2. **AI Research & Socratic Tab:** Displays comprehensive exploration reports, verification citations, and Socratic Atomizer dialogues. Any card or chart can be dragged onto the canvas.
  3. **Object & Zettel Vault Tab (Concepts-style Object Store + Agenda):**
     * *Primitives:* Draggable vector shapes (axes, flowchart boxes, tables).
     * *Zettel Vault:* Searchable permanent Atomic Zettels (showing both original ink snapshot and AI synthesis) ready to drag onto any canvas.
     * *Agenda View:* Unified list of all handwritten `[ ]` tasks and `@date` items extracted across canvases.

### 2.5 Non-Blocking Async Badges (`◌ → 🔄 → ●`)
* When user triggers AI via Violet ink or Lasso `? Verify`:
  * A small vector badge dynamically anchors to the top-right corner (`max_x, min_y`) of the target `stroke_cluster` or node:
    * `◌ Queued`: Enqueued in local SQLite job queue.
    * `🔄 Running`: Worker is executing web search / VLM evaluation.
    * `● Ready`: Worker complete. Glows `Forest Green` (verified), `Amber` (nuanced/disputed), or `Cobalt` (data/graph ready).
  * The user's stroke input is never paused, blocked, or intercepted.

---

## 3. Engineering Architecture & The Ephemeral-Wet / Unified-Dry Sandwich

To achieve **<8ms stylus latency** while preventing **pan/zoom frame drift ("swimming badges")** and allowing **true Z-index layer interleaving** (e.g., drawing `Presentation Ink` *on top* of a `Zettel Card` which sits *on top* of `Draft Ink`), NoteFlow uses an **Ephemeral Wet-Ink Overlay + Unified Scene Graph Architecture**.

```
+=============================================================================+
|             1. TOP: EPHEMERAL WET-INK OVERLAY (<4ms, Active Stroke)         |
|  (Native Metal/Vulkan OR Desynchronized WebGL2 Canvas with Predicted Events)|
|                                                                             |
| • Renders ONLY the active in-flight stroke (`PEN_DOWN` to `PEN_UP`) at 240Hz|
| • Uses OS motion prediction (`predictedTouches` / `getPredictedEvents()`)   |
| • Clears active stroke immediately once Dry Scene Graph paints the commit   |
+=============================================================================+
                                      │
                   [ Zero-Copy Commit on `PEN_UP` ]
                                      │
+=============================================================================+
|           2. MIDDLE: UNIFIED SCENE GRAPH & REACT SHELL (120fps)             |
|                                                                             |
| • UNIFIED CANVAS RENDERER (WebGL2 / Skia CanvasKit):                        |
|   Renders all Committed Dry Ink, PDF Snippets, Zettel Cards, and Async      |
|   Badges (`◌` `🔄` `●`) under ONE shared camera matrix & layer stack.      |
| • REACT 19 UI CHROME OVERLAY:                                               |
|   Dockable Radial Wheel, Layer Pill, and Split-Screen Research Drawer.      |
+=============================================================================+
                                      │
                           [ Async Worker Bridge ]
                                      │
+=============================================================================+
|                 3. BOTTOM: WORKER & LOCAL DATABASE SUBSYSTEM                |
|                                                                             |
| • SQLite WASM + `sqlite-vec` + Auto-Synced R-Tree Spatial Index             |
| • Tier 0 Spatio-Temporal Stroke Clusterer                                   |
| • Tier 1 Local OCR (Apple Vision / Android MLKit / Tesseract WASM)          |
| • Tier 2 Local MiniLM Embeddings (ONNX Runtime WASM, 22MB)                  |
| • Tier 3/4 Agentic Worker: Edge VLM & Cloud Multimodal / Search Tool Calls  |
+=============================================================================+
```

### 3.1 Pen-to-Pixel & Scene Graph Contract
1. **Zero Pan/Zoom Drift Invariant:** Async Status Badges (`◌ 🔄 ●`), PDF Snippets, and Dry Vector Strokes MUST share the exact same camera transformation matrix `(panX, panY, zoom, rotation)` inside the Unified Scene Graph so badges never lag behind ink during 120Hz pinch-zooming.
2. **True Layer Interleaving:** The Unified Scene Graph iterates through `layers` ordered by `z_index ASC`, rendering all `spatial_nodes` (whether `vector_stroke`, `pdf_snippet`, or `zettel_card`) belonging to each layer in order.
3. **Commit Handoff:** On `PEN_UP`, the Wet-Ink layer simplifies the polyline and emits a `StrokeCommittedEvent`:

```typescript
export interface StrokeCommittedEvent {
  nodeId: string;          // UUID
  canvasId: string;
  layerId: string;
  bbox: [minX: number, minY: number, maxX: number, maxY: number];
  points: Float32Array;    // [x0, y0, pressure0, timestamp0, x1, y1, ...]
  style: {
    colorId: 'noir' | 'cobalt' | 'crimson' | 'forest' | 'amber' | 'violet';
    width: number;
    brushType: 'pen' | 'marker' | 'highlighter';
  };
}
```

---

## 4. 5-Stage Intelligence Hierarchy (Clustering, Cost & Battery Optimization)

Because a single `StrokeCommittedEvent` is often just a single letter or the dot of an `'i'`, OCR must **never** run on isolated strokes. All canvas intelligence passes through a 5-stage funnel (Tier 0 to Tier 4):

```
[ StrokeCommittedEvent ]
           │
           ▼
  +─────────────────────────────────────────────────────────────────+
  | TIER 0: Spatio-Temporal Stroke Clustering (Free, <5ms)          |
  | • Debounces for 1200ms after pen pause (or triggers immediately |
  |   if stroke is `violet` highlighter or lasso selection).        |
  | • Queries R-Tree to merge strokes on the same layer within      |
  |   Δx < 48px, Δy < 24px into a parent `stroke_cluster` node.     |
  +─────────────────────────────────────────────────────────────────+
           │
           ▼
  +─────────────────────────────────────────────────────────────────+
  | TIER 1: On-Device OCR on `stroke_cluster` (Free, <50ms)         |
  | • Runs on the merged bounding box of the `stroke_cluster`.      |
  | • Updates cluster's `ocr_transcript` and detects `[ ]` / `@date`|
  +─────────────────────────────────────────────────────────────────+
           │ (Diff check: >= 10 new characters in cluster?)
           ▼
  +─────────────────────────────────────────────────────────────────+
  | TIER 2: Local Embedding & Similarity (Free, <100ms)             |
  | • ONNX all-MiniLM-L6-v2 (22MB local model, 384-dim)             |
  | • `sqlite-vec` cosine similarity against user Zettels           |
  | • Candidate Ghost Links queued if similarity > 0.82             |
  +─────────────────────────────────────────────────────────────────+
           │ (Significant spatial/structural shift on board?)
           ▼
  +─────────────────────────────────────────────────────────────────+
  | TIER 3: Edge/Device VLM (Free, 1-2s)                            |
  | • Gemini Nano / Apple Intelligence / Local Vision               |
  | • Detects drawn arrows between clusters, tables, diagrams       |
  | • Updates JSON `CanvasContextState`                             |
  +─────────────────────────────────────────────────────────────────+
           │
           ▼ (ONLY on explicit user action:
              Violet ink highlight, Lasso '? Verify' / '📊 Graph',
              '⚛ Atomize', or Push-to-Talk voice prompt)
  +─────────────────────────────────────────────────────────────────+
  | TIER 4: Cloud Multimodal Agent ($0.01 - $0.03/query)            |
  | • Claude Sonnet / Gemini 2.5 Pro + Search API                   |
  | • Executes external web search & source verification            |
  | • Emits tool calls to update status badge & canvas nodes        |
  +─────────────────────────────────────────────────────────────────+
```

---

## 5. Dual-Legibility Software Architecture (Human + AI Readability)

To ensure this codebase remains maintainable, extendable, and debuggable by both **human engineers** and **autonomous AI coding agents**, the software enforces strict invariants.

### 5.1 Design Invariants
1. **Zero Implicit Global State:** All application state is governed by typed stores (Zustand/Signals) with explicit actions.
2. **Type Invariants Enforced by Zod:** Every data boundary (Bridge events, SQLite rows, AI tool calls, Worker messages) MUST have a runtime Zod schema paired with static TypeScript types.
3. **Command Pattern for Canvas Mutations:** Direct state tampering is prohibited. All canvas modifications are atomic `CanvasCommand` objects with guaranteed `execute()` and `undo()` implementations.

### 5.2 Strict Directory Structure
```
noteflow/
├── docs/
│   ├── ARCHITECTURE.md          # System invariants & architectural decisions
│   ├── ADR/                     # Architecture Decision Records (ADR-001, etc.)
│   └── repo-map.json            # Machine-readable dependency & boundary map
├── native/                      # Optional native low-latency wet-ink bridges
│   ├── ios/                     # PencilKit / Metal wet-ink bridge
│   └── android/                 # Jetpack Ink / Vulkan wet-ink bridge
├── src/
│   ├── core/                    # Pure domain logic (ZERO UI / ZERO Framework)
│   │   ├── canvas/              # Camera matrix, Bounding Boxes, Clustering math
│   │   ├── zettel/              # Zettelkasten data models & graph logic
│   │   └── commands/            # Undoable CanvasCommand transactions
│   ├── db/                      # Local-first persistence
│   │   ├── schema.sql           # SQLite tables, R-Tree, & auto-sync triggers
│   │   ├── client.ts            # SQLite WASM + sqlite-vec connection
│   │   └── repositories/        # SpatialNode, Zettel, AsyncJob repositories
│   ├── ai/                      # 5-Stage Intelligence Pipeline (Tier 0 - Tier 4)
│   │   ├── tier0_clustering/    # Spatio-temporal stroke grouping
│   │   ├── tier1_ocr/           # Local OCR adaptors & [ ] / @date parser
│   │   ├── tier2_embeddings/    # ONNX MiniLM runtime
│   │   ├── tier3_edge_vlm/      # Device VLM adaptors
│   │   ├── tier4_cloud/         # Cloud agents & search tool implementations
│   │   └── agent_contract.ts    # Typed Zod tool definitions for LLMs
│   ├── ui/                      # React 19 UI Shell & Unified Scene Graph
│   │   ├── scene_graph/         # Unified WebGL/Skia renderer (Dry ink + Cards + Badges)
│   │   ├── wheel/               # Concepts Radial Tool Wheel
│   │   ├── drawer/              # Split-Screen (PDF Reader, Socratic AI, Object Vault)
│   │   ├── badges/              # Async status badge hit-testing & popovers
│   │   └── layers/              # Smart layer stack controls
│   └── state/                   # State Machines & Reactive Stores
│       ├── gesture_fsm.ts       # Deterministic FSM with 8px touch-slop deadzone
│       ├── async_job_queue.ts   # Non-blocking background job scheduler
│       └── canvas_store.ts      # Active viewport camera, selection, layer state
└── tests/
    ├── headless/                # Headless canvas tests (Runs without screen/GPU)
    ├── mocks/                   # Mock digitizer, mock LLM, mock OCR
    └── benchmarks/              # 10,000-stroke R-Tree & clustering benchmarks
```

### 5.3 Explicit State Machines: Touch-Slop Disambiguated Gesture FSM
To prevent `1-Finger Pan` from colliding with `1-Finger Stationary Hold + Stylus Lasso/Voice`, the Gesture FSM enforces a `TOUCH_1_PENDING` state with an `8px` movement slop deadzone and a `220ms` hold timer:

```typescript
// src/state/gesture_fsm.ts
export type GestureState =
  | 'IDLE'
  | 'PEN_DRAWING'
  | 'TOUCH_1_PENDING'          // Disambiguates stationary hold vs. pan (8px slop)
  | 'TOUCH_PANNING'
  | 'TOUCH_PINCH_ZOOMING'
  | 'TOUCH_HOLD_MODIFIER'      // Finger held stationary >=220ms; ready for Pen or Voice
  | 'TOUCH_HOLD_PEN_LASSOING'
  | 'TOUCH_HOLD_VOICE_PROMPTING';

export type GestureEvent =
  | { type: 'PEN_DOWN'; x: number; y: number; pressure: number }
  | { type: 'PEN_UP' }
  | { type: 'TOUCH_START'; touches: Array<{ id: number; x: number; y: number }> }
  | { type: 'TOUCH_MOVE_BEYOND_SLOP' } // Fired when finger moves > 8px from TOUCH_START
  | { type: 'TOUCH_HOLD_TIMEOUT' }     // Fired after 220ms if finger stayed <= 8px
  | { type: 'VOICE_DETECTED' }
  | { type: 'TOUCH_END'; remainingTouches: number };

export function gestureReducer(state: GestureState, event: GestureEvent): GestureState {
  switch (state) {
    case 'IDLE':
      if (event.type === 'PEN_DOWN') return 'PEN_DRAWING';
      if (event.type === 'TOUCH_START' && event.touches.length === 1) return 'TOUCH_1_PENDING';
      if (event.type === 'TOUCH_START' && event.touches.length >= 2) return 'TOUCH_PINCH_ZOOMING';
      return state;

    case 'TOUCH_1_PENDING':
      if (event.type === 'PEN_DOWN') return 'TOUCH_HOLD_PEN_LASSOING';
      if (event.type === 'TOUCH_MOVE_BEYOND_SLOP') return 'TOUCH_PANNING';
      if (event.type === 'TOUCH_HOLD_TIMEOUT') return 'TOUCH_HOLD_MODIFIER';
      if (event.type === 'TOUCH_START' && event.touches.length >= 2) return 'TOUCH_PINCH_ZOOMING';
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;

    case 'TOUCH_PANNING':
      if (event.type === 'TOUCH_START' && event.touches.length >= 2) return 'TOUCH_PINCH_ZOOMING';
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;

    case 'TOUCH_HOLD_MODIFIER':
      if (event.type === 'PEN_DOWN') return 'TOUCH_HOLD_PEN_LASSOING';
      if (event.type === 'VOICE_DETECTED') return 'TOUCH_HOLD_VOICE_PROMPTING';
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;

    case 'TOUCH_HOLD_PEN_LASSOING':
      if (event.type === 'PEN_UP') return 'TOUCH_HOLD_MODIFIER';
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;

    case 'PEN_DRAWING':
      if (event.type === 'PEN_UP') return 'IDLE';
      return state;

    default:
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;
  }
}
```

### 5.4 Command Pattern: Atomic Canvas Mutations
Every mutation is an undoable transaction. Because `<AsyncStatusBadge />` coordinates are dynamically derived from their `anchor_node_id`'s bounding box (`max_x, min_y`), moving a spatial node automatically moves its anchored badge and updates the SQLite R-Tree via database triggers.

```typescript
// src/core/commands/canvas_command.ts
export interface CanvasCommand {
  readonly id: string;
  readonly description: string;
  execute(db: DatabaseSession): Promise<void>;
  undo(db: DatabaseSession): Promise<void>;
}

export class MoveNodesCommand implements CanvasCommand {
  readonly id = crypto.randomUUID();
  readonly description = 'Translate spatial nodes and child strokes';

  constructor(
    private readonly nodeIds: string[],
    private readonly deltaX: number,
    private readonly deltaY: number
  ) {}

  async execute(db: DatabaseSession): Promise<void> {
    // Updates min_x, max_x, min_y, max_y on spatial_nodes (and child strokes).
    // SQLite `sync_rtree_update` trigger automatically updates spatial_nodes_rtree.
    // Anchored async_jobs badges automatically follow `anchor_node_id` bounding box.
    await db.spatialNodes.translateBatch(this.nodeIds, this.deltaX, this.deltaY);
  }

  async undo(db: DatabaseSession): Promise<void> {
    await db.spatialNodes.translateBatch(this.nodeIds, -this.deltaX, -this.deltaY);
  }
}
```

### 5.5 AI Agent Tool Contract
When a Cloud VLM or autonomous agent modifies the canvas, it interacts strictly through typed tool calls:

```typescript
// src/ai/agent_contract.ts
import { z } from 'zod';

export const CreateZettelCardToolSchema = z.object({
  canvasId: z.string().uuid(),
  layerId: z.string().uuid(),
  position: z.object({ x: z.number(), y: z.number() }),
  title: z.string().min(1).max(120),
  atomicStatement: z.string().min(10).max(1000),
  citationTether: z.object({
    pdfId: z.string().optional(),
    pageNumber: z.number().int().optional(),
    originNodeId: z.string().optional(),
  }).optional(),
  tags: z.array(z.string()),
});

export const UpdateJobBadgeToolSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  badgeColor: z.enum(['forest', 'amber', 'cobalt']),
  summary: z.string(),
  detailedMarkdown: z.string(),
});
```

### 5.6 Headless AI Testing Harness (No Physical Tablet Required)
To allow autonomous AI coding agents to verify their work in CI/CD without an iPad or Galaxy Tab attached, NoteFlow includes a Headless Simulation Environment:
* **Mock Digitizer:** Injects synthetic `PointerEvents` (`pointerType: 'pen'` and `'touch'`) with pressure, velocity, and touch-slop sequences.
* **Canvas & R-Tree Assertions:** Verifies that strokes commit to `spatial_nodes`, SQLite triggers populate `spatial_nodes_rtree`, Tier 0 merges nearby strokes into `stroke_cluster` nodes, and badges anchor to `(max_x, min_y)`.
* **Deterministic AI Replay:** Mocks OCR and VLM tool calls to test `◌ → 🔄 → ●` badge transitions in `<50ms`.

---

## 6. Database Schema (SQLite + `sqlite-vec` + Auto-Synced R-Tree)

> **CRITICAL SQLITE INVARIANT:** SQLite `rtree` virtual tables require a 64-bit signed `INTEGER` primary key. Therefore, `spatial_nodes_rtree.id` maps directly to `spatial_nodes.rowid` (SQLite's built-in integer row identifier) via automatic SQL triggers. Never insert UUID strings into `spatial_nodes_rtree.id`.

```sql
-- 1. Canvases
CREATE TABLE canvases (
    id TEXT PRIMARY KEY,           -- UUID
    title TEXT NOT NULL,
    grid_config JSON NOT NULL DEFAULT '{"type":"dot","spacing":20,"snap":false}',
    context_summary JSON,          -- Maintained by Tier 3 Edge VLM
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Layers
CREATE TABLE layers (
    id TEXT PRIMARY KEY,           -- UUID
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    name TEXT NOT NULL,            -- 'Presentation', 'AI Layer', 'Draft Ink', 'Reference'
    z_index INTEGER NOT NULL,
    opacity REAL DEFAULT 1.0,
    is_visible BOOLEAN DEFAULT 1,
    is_locked BOOLEAN DEFAULT 0,
    auto_tool_binding TEXT         -- e.g. 'violet' -> AI Layer
);

-- 3. Spatial Nodes (Uses implicit integer `rowid` for R-Tree mapping)
CREATE TABLE spatial_nodes (
    id TEXT PRIMARY KEY,           -- UUID for application & React layer
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    parent_group_id TEXT REFERENCES spatial_nodes(id) ON DELETE SET NULL, -- Links raw strokes to a `stroke_cluster`
    node_type TEXT NOT NULL,       -- 'vector_stroke', 'stroke_cluster', 'pdf_snippet', 'zettel_card', 'ai_chart'
    min_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_x REAL NOT NULL,
    max_y REAL NOT NULL,
    vector_payload JSON,           -- Compressed point stream [{x,y,p,t}] or SVG/chart spec
    style_config JSON NOT NULL,    -- {colorId: 'noir', width: 1.5, brush: 'pen', isTask: false, isCompleted: false, dueDate: null}
    ocr_transcript TEXT,           -- Populated by Tier 1 OCR on `stroke_cluster`
    source_provenance JSON,        -- {pdfId, page, bbox, url}
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Spatial Index for Instant Lasso & Viewport Culling
-- Maps `id` (INTEGER) to `spatial_nodes.rowid`
CREATE VIRTUAL TABLE spatial_nodes_rtree USING rtree(
    id,
    min_x, max_x,
    min_y, max_y
);

-- Automatic Triggers to Keep R-Tree Synchronized with `spatial_nodes`
CREATE TRIGGER sync_rtree_insert AFTER INSERT ON spatial_nodes BEGIN
    INSERT INTO spatial_nodes_rtree(id, min_x, max_x, min_y, max_y)
    VALUES (new.rowid, new.min_x, new.max_x, new.min_y, new.max_y);
END;

CREATE TRIGGER sync_rtree_update AFTER UPDATE OF min_x, min_y, max_x, max_y ON spatial_nodes BEGIN
    UPDATE spatial_nodes_rtree
    SET min_x = new.min_x, max_x = new.max_x, min_y = new.min_y, max_y = new.max_y
    WHERE id = new.rowid;
END;

CREATE TRIGGER sync_rtree_delete AFTER DELETE ON spatial_nodes BEGIN
    DELETE FROM spatial_nodes_rtree WHERE id = old.rowid;
END;

-- 4. Asynchronous Background Jobs
-- Badge position is derived dynamically via JOIN on `anchor_node_id` (spatial_nodes.max_x, spatial_nodes.min_y)
CREATE TABLE async_jobs (
    id TEXT PRIMARY KEY,           -- UUID
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    anchor_node_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,        -- 'verify_claim', 'deep_research', 'generate_graph', 'atomize'
    status TEXT NOT NULL,          -- 'queued', 'running', 'completed', 'failed'
    badge_color TEXT,              -- 'forest', 'amber', 'cobalt'
    input_snapshot_uri TEXT,
    result_payload JSON,           -- {summary, markdown, citations, chartSpec}
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

-- 5. Atomic Zettelkasten Vault
CREATE TABLE zettels (
    id TEXT PRIMARY KEY,           -- UUID
    title TEXT NOT NULL,
    atomic_statement TEXT NOT NULL,
    handwriting_snapshot_uri TEXT, -- Cropped PNG/SVG of original ink cluster
    socratic_qa_log JSON,          -- Socratic dialogue record
    source_provenance JSON NOT NULL,
    tags JSON NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Zettel Vector Embeddings (sqlite-vec)
CREATE VIRTUAL TABLE zettel_embeddings USING vec0(
    zettel_id TEXT PRIMARY KEY,
    embedding FLOAT[384]           -- 384 dimensions for all-MiniLM-L6-v2
);

-- 7. Knowledge Graph Links
CREATE TABLE zettel_links (
    source_id TEXT NOT NULL REFERENCES zettels(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES zettels(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,   -- 'supports', 'contradicts', 'extends', 'example_of'
    rationale TEXT,
    PRIMARY KEY (source_id, target_id)
);
```

---

## 7. Phased Implementation Roadmap & Evaluation Gates

```
+-----------------------------------------------------------------------------+
| PHASE 0: INK FOUNDATION & PRODUCT KERNEL (Weeks 1 - 4)                      |
| Deliverable: Wet/Dry Unified Scene Graph + Radial Wheel + Tier 0 Clustering |
|              + 1 Async Verify loop (`◌ → 🔄 → ●`).                          |
| Evaluation Gate #0: 5 users take 15 mins of notes. Zero pen lag or badge    |
|                     swimming during 120Hz pan/zoom.                         |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 1: CORE NOTE-TAKING, LAYERS & PDF EXTRACTION (Weeks 5 - 10)           |
| Deliverable: Smart Layers + PDF Split Drawer + Liquid Snippet Extraction +  |
|              Object & Zettel Vault Tab.                                     |
| Evaluation Gate #1: User extracts 3 PDF citations onto canvas effortlessly. |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 2: TIERED INTELLIGENCE & SOCRATIC ATOMIZER (Weeks 11 - 16)            |
| Deliverable: Tier 1-3 Local OCR/Embedding/Edge VLM + `[ ]` Task Agenda +    |
|              Socratic dialogue for Zettel saves.                            |
| Evaluation Gate #2: 2hr study session costs <$0.30 in AI tokens.            |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 3: ZETTEL GRAPH, GHOST LINKS & TEACHING (Weeks 17 - 22)               |
| Deliverable: Ghost Link edge notifications + Presentation layer toggle      |
|              with laser pointer and Artboard PDF export.                    |
| Evaluation Gate #3: User delivers 10-min lecture directly from canvas.      |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 4: PERFORMANCE SPRINT & BETA LAUNCH (Weeks 23 - 28)                   |
| Deliverable: 10,000+ vector stroke performance profiling + Beta rollout.    |
| Evaluation Gate #4: 50 active beta testers; 14-day retention > 40%.         |
+-----------------------------------------------------------------------------+
```

---

## 8. Agentic AI Coding Team Playbook (Instructions for AI Agents)

When an autonomous AI coding agent begins working in this repository:

1. **Check System Boundaries:** Read `docs/ARCHITECTURE.md` and `docs/repo-map.json` before modifying files across layers.
2. **Respect the SQLite R-Tree Invariant:** Always query `spatial_nodes_rtree` by joining `spatial_nodes.rowid = spatial_nodes_rtree.id`. Never manually insert into `spatial_nodes_rtree` (let the SQL triggers handle it).
3. **Never Run OCR on Raw Single Strokes:** Ensure all committed strokes pass through `src/ai/tier0_clustering/` to form or update a `stroke_cluster` before invoking Tier 1 OCR.
4. **Never Break Type Invariants:** Run `npm run typecheck` and verify all Zod schemas pass before committing.
5. **Run Headless Harness First:** Run `npm run test:headless` to verify that the `gesture_fsm` (including the 8px touch-slop deadzone), `CanvasCommand` undo/redo, and R-Tree spatial queries pass 100% before touching UI components.
6. **No Direct State Hacks:** Never mutate canvas nodes outside of an atomic `CanvasCommand`.


