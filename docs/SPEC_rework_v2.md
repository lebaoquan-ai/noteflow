# NoteFlow: Engineering Handover Specification & Architecture (v2.0)

**Document Version:** 2.0   
**Primary Target System:** Android Tablet (Samsung Galaxy Tab + S-Pen via Jetpack Ink / Vulkan) *(Secondary/Future: iPadOS and b/w e-ink)*  
**Primary Paradigm:** Handwriting-First, AI-Native Spatial & Page-Structured Zettelkasten  
**Primary Audience:** Human Systems Architects & Autonomous AI Coding Agents  

---

## 1. Executive Summary & Product Vision

### 1.1 The Core Problem & Value Proposition
Learners and thinkers on tablets suffer from the **"Split-Screen Tax"**:
* **Handwriting/Drawing Apps** (*Concepts, Samsung Notes, Goodnotes*) offer fluid upto 120Hz ink, responsive radial/toolbar ergonomics, and spatial freedom, but act as dead-pixel silos with zero semantic knowledge graphs or research tools.
* **PKM & AI Research Tools** (*Obsidian, Heptabase, NotebookLM*) offer atomic notes, bidirectional graph linkage, and source-grounded synthesis, but are strictly keyboard- and text-block-centric.
* Moving between handwriting and synthesis requires constant copying, context switching, and fragmented attention.

```
+------------------------------------+       +------------------------------------+
|       HANDWRITING SILOS            |       |        KNOWLEDGE SILOS             |
|    (Concepts, Samsung Notes)       |       |  (Obsidian, Heptabase, NotebookLM) |
| • Fluid 120Hz S-Pen ink & canvas   |  vs.  | • Atomic notes & graph connections |
| • Responsive tool wheel & stroke   |       | • Source-grounded AI synthesis     |
|   eraser, but dumb vector storage  |       | • Keyboard-first; NO stylus flow   |
+------------------------------------+       +------------------------------------+
                  \                             /
                   \--- [ SPLIT-SCREEN TAX ] --/
                                  |
                                  v
                    +---------------------------+
                    |         NOTEFLOW          |
                    |  Visual Zettelkasten      |
                    |  Handwriting-First (S-Pen)|
                    |  AI-Assisted Organization |
                    +---------------------------+
```

### 1.2 The NoteFlow Solution
NoteFlow combines the tactile ergonomics of **Concepts App** (direct replica of the dockable radial tool wheel, infinite spatial plane, object store) and the simplicity and intuitiveness of **Samsung Notes** (snappy responsiveness, default stroke-eraser behavior, structured page awareness) with an **Asynchronous Local-First AI Agent** and an **Auto-Atomizing Zettelkasten Engine**.

### 1.3 Core Zettelkasten Philosophy: Hierarchical Auto-Atomization
A single handwritten note often births multiple distinct ideas. NoteFlow actively assists the user in splitting and linking these into permanent **Atomic Notes (Zettels)**:
* **Heading-Driven Atomization (`#`, `##`, `###`):** When a user writes a master note—for example, *"Ngũ Hành" (Five Phases)* containing five sections (*Kim, Mộc, Thủy, Hỏa, Thổ*)—each section prefixed with handwritten `#`, `##`, or `###` is recognized as a candidate Atomic Note.
* **Handwritten-symbol to text:** certain handwritten symbols/drawing structures (arrow "-->", group of multiple ideas "{ }", table of comparisons "vs." and loop-cycle "when arrows and ideas form together as a loop") must be recognized and saved as text-based in zettelkasten-style notes 
* **User-Confirmed Splitting:** The system prompts the user via a non-blocking badge/toast to accept splitting `#` / `##` / `###` sections into standalone Atomic Zettels.
* **Automatic Hierarchical Linking:** Notes created within the same page using `#`, `##`, and `###` are automatically linked together in the knowledge graph (`parent_of` / `child_of` up-one-level or down-one-level, plus sibling connections). Also such symbol "#" also signal this will be atomic idea, otherwise treat as fleeting note

### 1.4 The Three Core Modes
1. **Brainstorm & Plan (Divergent Mode):** Page-structured infinite vector canvas, fluid ink, smart handwritten syntax (`[[link]]`, `#`, `[ ]`, `@date`) with zero keyboard dependency.
2. **Read & Learn (Absorptive Mode):** Left/Right side-drawer for PDF/Book reading and AI Chat. Bimanual interaction: fingers scroll/zoom the PDF while the S-Pen instantly selects and drags snippets onto the note canvas with immutable citation tethers.
3. **Synthesize & Teach (Convergent Mode):** Auto-distillation of multi-idea notes into linked atomic Zettels, presentation layer toggle, and laser-pointer teaching.

### 1.5 The Product Kernel (The 80/20 Test Loop)
The core interaction loops that must feel responsive and intuitive before building secondary features:
```
LOOP A: ASYNC RESEARCH & VERIFICATION
[Write Claim by Hand] ──► [Violet Highlight OR Lasso + Draw "?"] 
        │
        ▼ (Non-blocking queue: ◌ Queued → 🔄 Running)
[Continue Writing Elsewhere] ──► [Badge Glows: ● Ready] ──► [Tap to Inspect / Drag Fact to Canvas]

LOOP B: HANDWRITTEN ZETTELKASTEN & AUTO-ATOMIZATION
[Write Note with "# Kim", "## Mộc" or "[[ Concept ]]"]
        │
        ▼ (Tier 1 OCR + Symbol Parser)
[Detects `[[__]]` Link OR `#` Atomic Split Candidate]
        │
        ├─► If `[[Exact Match]]`: Auto-creates bidirectional Zettel tether.
        ├─► If `[[Ambiguous / Missing]]`: Highlights in Crimson Red; tap to pick target or create new Zettel.
        └─► If `#` / `##` / `###`: auto-splitting into hierarchically linked Atomic Zettels.
```

---

## 2. Core Functional & UI/UX Specifications

### 2.1 The Concepts-Style Radial Tool Wheel
A direct ergonomic adaptation of the **Concepts App** tool wheel, operable by finger or S-Pen tap. Dockable to one of the corner and rotatable to see all other options

* **9 Outer Tool Slots:**
  1. `Primary Pen`: Pressure- and tilt-sensitive vector pen
  2. `Sketch Marker`: Semi-transparent chisel for diagram containers and headers.
  3. `Rainbow AI Highlighter`: Renders underneath ink; automatically triggers a background fact-check/research job on the intersected stroke cluster.
  4. `Smart Picker / Magic Lasso`: Context menu (`Move/Scale`, `? Verify/Search`, `✦ Explore`, `📊 Graph`, `⚛ Atomize`).
  5. `Eraser`: **Defaults to *Stroke Eraser*** (Samsung Notes style: touching any part of a stroke removes the whole vector stroke immediately). Can be toggled to *Slice Eraser* when partial trimming is desired.
  6. `Teaching Laser / Spotlight`: Disappearing ink + background canvas dimmer.
  7. `Undo`: undo the lastest stroke
  8. `Redo`: redo the lastest stroke
  9. `Secondary Pen`: Pressure- and tilt-sensitive vector pencil
* **Inner Ring (Stroke Width, Layer and Zoom lock):**
  * Stroke widths: `Fine` (1.2px), `Medium` (2.8px), `Thick` (6.0px). (customizable for each, and each has memory to each kind of pen/eraser)
  * Layer: Show all layers (drop down, use similar style to Concepts App) of a note.
  * Zoom lock/set: lock/unlock page zoom. 5 different zoom presets (10%, 25%, 100% == default, 250% and 1000%)
* **Center color-selection:** Tap the center to expand wheel (now larger than the outer tools) and select color 

### 2.2 Bimanual Touch & S-Pen Hardware Separation
Hardware events strictly enforce `event.pointerType === 'pen'` (S-Pen) vs. `'touch'` (Finger) across both the Main Canvas and the Side Drawers:

#### A. Main Canvas Gestures
* **Core Touch Gestures (Finger Only):**
  * `1-Finger Lasso (>8px slop)`: Hold 0.5s with a finger to lasso
  * `2-Finger Drag `: Pan canvas (with strict palm rejection when S-Pen is hovering/active).
  * `2-Finger Pinch / Rotate`: Zoom (10% to 3200%) and rotate (snaps to 0° within ±5°).
  * `2-Finger Double-Tap`: **Undo** (fast, deliberate hardware gesture that avoids accidental triggers).
  * `3-Finger Tap`: **Redo**.
  * `3-Finger Swipe Left/Right`: Toggle the Split-Screen Research Drawer.
* **Progressive Bimanual & Stylus Power Gestures:**
  * `1-Finger Stationary Hold (<=8px slop) + S-Pen lasso`: using AI to autoresearch  

#### B. Side-Drawer Bimanual Separation (PDF / Book Reader & AI Chatbot)
Inside the Split-Screen Drawer, touch and stylus roles are strictly separated for rapid research extraction:
* **Finger Touch in Drawer:** Exclusively controls **scrolling and pinch-zooming** the PDF/Book or AI chat history.
* **S-Pen in Drawer:** Exclusively performs **Quick Select** (highlighting text or marquee-selecting a PDF figure/diagram) followed by immediate **Drag-and-Drop (Copy-Paste)** directly onto the active note page.

### 2.3 Canvas System: Page-Structured Infinite Canvas & Smart Layers
* **Page-by-Page Arrangement on an Infinite Plane:**
  * To prevent the "lost in infinite space" chaos of pure infinite canvases while retaining spatial freedom, NoteFlow enforces **Page-Style Note Containers** laid out as a structured grid/sequence on an infinite 2D plane.
  * During **Brainstorming** (Note writing mode), users can zoom out, pan freely across the infinite plane, draw across page boundaries, or spawn ad-hoc scratchpad pages.
  * During **Organization** (File explore mode), pages snap cleanly into ordered rows/columns or stacks and map directly to parent/child Zettel structures.
* **Smart Layer Pill Stack (Per Page & Global):**
  * `Presentation Layer`: Clean diagrams, finalized cards, slides (visible during teaching mode).
  * `AI Layer`: AI-generated graphs, ghost links, synthesis cards, and atomization prompts.
  * `Draft Ink Layer`: Default user handwriting and sketches, unorganized ideas (fleeting notes)
  * `Reference Layer`: PDF clippings, web screenshots, raw quotes.
* **Teaching Mode Toggle:** Single tap hides `Draft` and `Reference` layers, spotlighting only `Presentation`.

### 2.4 Handwritten Symbol, Syntax & Shape Recognition
NoteFlow continuously parses handwriting clusters (Tier 0 + Tier 1) for structural syntax and gesture shortcuts:
(Not sure if this is the efficient way, however, to make sure all functions/features work properly, lets test it this way first)

| Handwritten Trigger / Gesture | System Behavior & UI Feedback |
| :--- | :--- |
| **`[[ Note Name ]]`** (WikiLink Syntax) | Searches the local Zettel Vault for `Note Name`.<br>• **Exact Match Found:** Converts bracketed ink glow to `Cobalt Blue` and creates a live bidirectional link.<br>• **No Match or Multiple Similar Matches:** Highlights the bracketed ink in **`Crimson Red`**. Tapping the red highlight opens a compact disambiguation popover allowing the user to select the intended existing note or tap `+ Create New Atomic Note`. |
| **`#`, `##`, `###`** (Heading & Auto-Atomizer Syntax) | Marks the start of a hierarchical section/idea within a page.<br>• Automatically links sections on the same page hierarchically (`#` = Parent, `##` = Child, `###` = Grandchild; e.g., *"Ngũ Hành"* → *Kim, Mộc, Thủy, Hỏa, Thổ*).<br>• Surfaces an **Atomize Proposal Badge (`⚛`)**: upon user acceptance, extracts each `#`/`##` block into its own linked Atomic Note card in the Zettel Vault. |
| **Circle a Chunk of Text** (Auto-Lasso Grouping) | Drawing a closed loop around a cluster of handwritten text automatically recognizes the gesture as a **Lasso & Group-By** operation, binding the enclosed strokes into a cohesive movable group and surfacing quick actions. |
| **Lasso + Draw `?`** | Selecting a region via Lasso and sketching a `?` glyph immediately dispatches an **AI Search / Verification Job** (`◌ → 🔄 → ●`) on the selected ink/snippet. |
| **`[ ]` and `@date`** | Recognizes handwritten tasks and dates, aggregating them automatically into the Vault's Agenda View. |
| **Extensible Glyph Registry** | Architecture supports pluggable symbol recognizers (e.g., `!`, `*`, arrows `->`, geometric primitives) for future user-defined macros. |


### 2.5 Split-Screen Research Drawer (Left/Right Dockable) & Object Store
The side drawer can be docked to either the **Left or Right** side of the screen (resizable 30% / 50% / hidden) to accommodate left- and right-handed S-Pen users, featuring 3 tabs:
1. **PDF / Book Reader Tab (`PDF.js` Worker):**
   * Finger scrolls/zooms; S-Pen quick-selects text or diagrams and drags them onto the canvas as spatial nodes with an immutable **Citation Tether** (`pdf_id`, `page_number`, `bounding_box`).
2. **AI Chatbot & Socratic Research Tab:**
   * Interactive AI research assistant, verification citations, and Socratic Atomizer dialogues. Finger scrolls chat; S-Pen selects and drags any AI response, formula, or chart onto a note page.
3. **Object Store & Zettel Vault Tab:**
   * **User Object Store:** Stores custom user-drawn sketches, diagrams, stamps, and reusable UI/flowchart primitives to be dragged onto any page later.
   * **Zettel Vault:** Searchable permanent Atomic Zettels (showing both original ink snapshot and OCR/AI synthesis) with hierarchical tree and graph views.
   * **Agenda View:** Unified list of all handwritten `[ ]` tasks and `@date` items extracted across pages.

### 2.6 Non-Blocking Async Badges (`◌ → 🔄 → ●` & `⚛`)
When the user triggers AI (via Violet ink, Lasso + `?`, or `#` Auto-Atomization), a small vector badge anchors to the top-right corner (`max_x, min_y`) of the target `stroke_cluster` or node:
* `◌ Queued`: Enqueued in local SQLite job queue.
* `🔄 Running`: Worker is executing OCR, link resolution, or VLM web search.
* `● Ready`: Worker complete. Glows `Forest Green` (verified), `Amber` (nuanced/disputed), `Cobalt` (data/graph ready), or `Crimson` (`[[__]]` link needs user disambiguation).
* `⚛ Atomize Ready`: Indicates that `#` / `##` / `###` sections have been detected and are ready for 1-tap user approval to split into linked Atomic Zettels.

---

## 3. Engineering Architecture & The Ephemeral-Wet / Unified-Dry Sandwich

To achieve **<4ms S-Pen latency** on Android 120Hz OLED displays while preventing **pan/zoom frame drift ("swimming badges")** and allowing **true Z-index layer interleaving**, NoteFlow uses an **Ephemeral Wet-Ink Overlay + Unified Scene Graph Architecture**.

```
+=============================================================================+
|             1. TOP: EPHEMERAL WET-INK OVERLAY (<4ms, Active Stroke)         |
|   (Android Jetpack Ink API / Vulkan SurfaceView + Motion Prediction API)    |
|                                                                             |
| • Renders ONLY the active in-flight stroke (`PEN_DOWN` to `PEN_UP`) at 240Hz|
| • Uses Android `MotionEventPredictor` (`getPredictedEvents()`)              |
| • Clears active stroke immediately once Dry Scene Graph paints the commit   |
+=============================================================================+
                                      │
                   [ Zero-Copy Commit on `PEN_UP` ]
                                      │
+=============================================================================+
|           2. MIDDLE: UNIFIED SCENE GRAPH & REACT SHELL (120fps)             |
|                                                                             |
| • UNIFIED CANVAS RENDERER (WebGL2 / Skia CanvasKit):                        |
|   Renders Page Frames, Committed Dry Ink, PDF Snippets, Zettel Cards,       |
|   `[[Link]]` Highlights, and Async Badges (`◌` `🔄` `●` `⚛`) under ONE      |
|   shared camera matrix & layer stack.                                       |
| • REACT 19 UI CHROME OVERLAY:                                               |
|   Concepts Radial Wheel, Layer Pill, and Left/Right Split-Screen Drawer.    |
+=============================================================================+
                                      │
                           [ Async Worker Bridge ]
                                      │
+=============================================================================+
|                 3. BOTTOM: WORKER & LOCAL DATABASE SUBSYSTEM                |
|                                                                             |
| • SQLite WASM + `sqlite-vec` + Auto-Synced R-Tree Spatial Index             |
| • Tier 0 Spatio-Temporal Stroke Clusterer & Closed-Loop Circle Detector     |
| • Tier 1 Local OCR (MLKit Digital Ink / Vision) + Syntax Parser (`#`,`[[]]`) |
| • Tier 2 Local MiniLM Embeddings (ONNX Runtime WASM, 22MB)                  |
| • Tier 3/4 Agentic Worker: Edge VLM & Cloud Multimodal / Search Tool Calls  |
+=============================================================================+
```

### 3.1 Pen-to-Pixel & Scene Graph Contract
1. **Zero Pan/Zoom Drift Invariant:** Page Frames, Async Status Badges (`◌ 🔄 ● ⚛`), `[[WikiLink]]` highlights, PDF Snippets, and Dry Vector Strokes MUST share the exact same camera transformation matrix `(panX, panY, zoom, rotation)` inside the Unified Scene Graph.
2. **True Layer Interleaving:** The Unified Scene Graph iterates through `layers` ordered by `z_index ASC`, rendering all `spatial_nodes` belonging to each layer in order.
3. **Commit Handoff:** On `PEN_UP`, the Wet-Ink layer simplifies the polyline and emits a `StrokeCommittedEvent`:

```typescript
export interface StrokeCommittedEvent {
  nodeId: string;          // UUID
  canvasId: string;
  pageId: string;          // Target Page frame on the infinite canvas
  layerId: string;
  bbox: [minX: number, minY: number, maxX: number, maxY: number];
  points: Float32Array;    // [x0, y0, pressure0, tiltX0, tiltY0, timestamp0, ...]
  isClosedLoop: boolean;   // Pre-computed geometric check for auto-lasso circle gesture
  style: {
    colorId: 'noir' | 'cobalt' | 'crimson' | 'forest' | 'amber' | 'violet';
    width: number;
    brushType: 'pen' | 'marker' | 'highlighter';
  };
}
```

---

## 4. 5-Stage Intelligence Hierarchy (Clustering, Syntax Parsing & AI)

Because a single `StrokeCommittedEvent` is often just a single letter or part of a bracket `[`, OCR must **never** run on isolated strokes (except single-stroke gestures like a closed-loop circle or a `?` glyph inside an active Lasso). All canvas intelligence passes through a 5-stage funnel:

```
[ StrokeCommittedEvent ]
           │
           ▼
  +─────────────────────────────────────────────────────────────────+
  | TIER 0: Spatio-Temporal Clustering & Shape/Gesture Detection    |
  | • Fast Geometric Check (<3ms):                                  |
  |   1. If `isClosedLoop` encloses existing strokes -> Auto-Lasso  |
  |      and group enclosed text cluster.                           |
  |   2. If Lasso is active and user draws `?` -> Trigger AI Search.|
  | • Spatio-Temporal Merge: Debounces 1200ms after pen pause,      |
  |   merging strokes on same page/layer within Δx<48px, Δy<24px    |
  |   into a `stroke_cluster`.                                      |
  +─────────────────────────────────────────────────────────────────+
           │
           ▼
  +─────────────────────────────────────────────────────────────────+
  | TIER 1: On-Device OCR & Zettelkasten Syntax Parser (<50ms)      |
  | • Runs Android MLKit Digital Ink / Local OCR on `stroke_cluster`|
  | • Regex & AST Syntax Parser detects:                            |
  |   - `[[Note Name]]`: Queries `zettels` table for exact/fuzzy    |
  |     title match. Sets cluster link state (`resolved` Cobalt vs  |
  |     `ambiguous_or_missing` Crimson Red).                        |
  |   - `#`, `##`, `###`: Flags cluster as Heading level 1/2/3,     |
  |     builds intra-page parent/child hierarchy, and queues        |
  |     user-confirmable Atomization proposal (`⚛`).                |
  |   - `[ ]` and `@date`: Extracts to Agenda index.                |
  +─────────────────────────────────────────────────────────────────+
           │ (Diff check: >= 10 new characters or new `#` section?)
           ▼
  +─────────────────────────────────────────────────────────────────+
  | TIER 2: Local Embedding & Fuzzy Link Resolution (<100ms)        |
  | • ONNX all-MiniLM-L6-v2 (22MB local model, 384-dim)             |
  | • Powers fuzzy candidate lookup when `[[__]]` has no exact match|
  | • `sqlite-vec` cosine similarity queues Ghost Links (> 0.82)    |
  +─────────────────────────────────────────────────────────────────+
           │ (Significant spatial/structural shift on page?)
           ▼
  +─────────────────────────────────────────────────────────────────+
  | TIER 3: Edge/Device VLM (Free, 1-2s)                            |
  | • Gemini Nano / Local Vision                                    |
  | • Detects drawn arrows between clusters, tables, diagrams       |
  | • Assists in grouping body paragraphs under `#` / `##` headings |
  +─────────────────────────────────────────────────────────────────+
           │
           ▼ (ONLY on explicit user action:
              Violet ink highlight, Lasso + `?` glyph,
              Accepting `⚛` Atomization, or Side-Drawer AI Chat)
  +─────────────────────────────────────────────────────────────────+
  | TIER 4: Cloud Multimodal Agent ($0.01 - $0.03/query)            |
  | • Claude Sonnet / Gemini Pro + Search API                       |
  | • Executes web search, claim verification, & Zettel distillation|
  | • Emits tool calls to update status badge & canvas nodes        |
  +─────────────────────────────────────────────────────────────────+
```

---

## 5. Dual-Legibility Software Architecture (Human + AI Readability)

To ensure this codebase remains maintainable, extendable, and debuggable by both **human engineers** and **autonomous AI coding agents**, the software enforces strict invariants.

### 5.1 Design Invariants
1. **Zero Implicit Global State:** All application state is governed by typed stores (Zustand/Signals) with explicit actions.
2. **Type Invariants Enforced by Zod:** Every data boundary (Bridge events, SQLite rows, AI tool calls, Worker messages) MUST have a runtime Zod schema paired with static TypeScript types.
3. **Command Pattern for Canvas Mutations:** Direct state tampering is prohibited. All canvas modifications (including Stroke Erase, Group-By Circle, and Auto-Atomize Splits) are atomic `CanvasCommand` objects with guaranteed `execute()` and `undo()` implementations.

### 5.2 Strict Directory Structure
```
noteflow/
├── docs/
│   ├── ARCHITECTURE.md          # System invariants & architectural decisions
│   ├── ADR/                     # Architecture Decision Records (ADR-001, etc.)
│   └── repo-map.json            # Machine-readable dependency & boundary map
├── native/                      # Native low-latency wet-ink bridges
│   ├── android/                 # Primary: Jetpack Ink + S-Pen MotionPredictor + Vulkan
│   └── ios/                     # Secondary: PencilKit / Metal wet-ink bridge
├── src/
│   ├── core/                    # Pure domain logic (ZERO UI / ZERO Framework)
│   │   ├── canvas/              # Camera matrix, Page grid math, Bounding Boxes
│   │   ├── syntax/              # Parsers for `[[link]]`, `#`/`##`/`###`, `[ ]`, `?`
│   │   ├── zettel/              # Zettelkasten hierarchy & auto-atomizer logic
│   │   └── commands/            # Undoable CanvasCommand transactions
│   ├── db/                      # Local-first persistence
│   │   ├── schema.sql           # SQLite tables, R-Tree, Object Store & triggers
│   │   ├── client.ts            # SQLite WASM + sqlite-vec connection
│   │   └── repositories/        # SpatialNode, Page, Zettel, ObjectStore repos
│   ├── ai/                      # 5-Stage Intelligence Pipeline (Tier 0 - Tier 4)
│   │   ├── tier0_clustering/    # Spatio-temporal grouping & closed-loop circle detector
│   │   ├── tier1_ocr/           # MLKit Digital Ink adaptor & syntax token extractor
│   │   ├── tier2_embeddings/    # ONNX MiniLM runtime & fuzzy `[[link]]` matcher
│   │   ├── tier3_edge_vlm/      # Device VLM adaptors
│   │   ├── tier4_cloud/         # Cloud agents & search tool implementations
│   │   └── agent_contract.ts    # Typed Zod tool definitions for LLMs
│   ├── ui/                      # React 19 UI Shell & Unified Scene Graph
│   │   ├── scene_graph/         # Unified WebGL/Skia renderer (Pages + Ink + Badges)
│   │   ├── wheel/               # Concepts-style Dockable Radial Tool Wheel
│   │   ├── drawer/              # Left/Right Drawer (PDF Reader, AI Chat, Object Store)
│   │   ├── popovers/            # Crimson `[[Link]]` disambiguator & `⚛` Atomize prompt
│   │   ├── badges/              # Async status badge hit-testing
│   │   └── layers/              # Smart layer stack controls
│   └── state/                   # State Machines & Reactive Stores
│       ├── gesture_fsm.ts       # Main Canvas + Drawer bimanual FSM
│       ├── async_job_queue.ts   # Non-blocking background job scheduler
│       └── canvas_store.ts      # Active viewport camera, page grid, layer state
└── tests/
    ├── headless/                # Headless canvas & syntax tests (No GPU required)
    ├── mocks/                   # Mock S-Pen digitizer, mock LLM, mock MLKit OCR
    └── benchmarks/              # 10,000-stroke R-Tree & clustering benchmarks
```

### 5.3 Explicit State Machines: Bimanual S-Pen & Touch Gesture FSM
The Gesture FSM enforces strict 2-finger camera navigation and bimanual stylus separation:
* `Immediate 1-Finger Move (<0.5s)` is a palm-safe no-op (returns to `IDLE`), whereas `1-Finger Hold (>=0.5s) + Finger Drag (>8px slop)` transitions to `TOUCH_LASSOING`.
* `1-Finger Stationary Hold (<=8px slop) + S-Pen Drag` transitions to `TOUCH_HOLD_PEN_AI_LASSOING` (instant AI Autoresearch).
* `2-Finger Double-Tap Undo` vs. `2-Finger Drag / Pinch / Rotate` (`TOUCH_2_NAVIGATING`).
* `Closed Circle + Hold (>= holdThresholdMs, default 300ms)` transitions to `LASSO_ACTIVE_AWAITING_GLYPH`, whereas `Closed Circle + Immediate Lift` keeps the visible circle and groups the enclosed strokes (`CLOSED_CIRCLE_GROUP`).
* `Side-Drawer`: Finger scrolls/zooms (`DRAWER_TOUCH_SCROLL_ZOOM`), S-Pen smart-selects via Lasso or Vertical Bracket (`DRAWER_PEN_SMART_SELECTING`), and the next touch/stylus inside the selection drags it onto the canvas (`DRAWER_SELECTION_DRAGGING_TO_CANVAS`).

```typescript
// src/state/gesture_fsm.ts
export type GestureState =
  | 'IDLE'
  | 'PEN_DRAWING'
  | 'PEN_STROKE_ERASING'                  // Default Samsung Notes-style whole-stroke eraser
  | 'PEN_TEACHING_LASER'                  // Fading laser trail or closed-loop spotlight dimmer
  | 'TOUCH_1_PENDING'                     // Awaits 0.5s hold timer; immediate move <0.5s is palm-safe no-op
  | 'TOUCH_HOLD_MODIFIER'                 // 1-Finger held stationary >=500ms (or ready for S-Pen AI Lasso)
  | 'TOUCH_LASSOING'                      // 1-Finger held >=500ms then dragged >8px slop
  | 'TOUCH_HOLD_PEN_AI_LASSOING'          // 1-Finger stationary hold + S-Pen lasso -> Instant AI Autoresearch
  | 'TOUCH_2_PENDING_TAP_OR_NAV'          // Tracks 2-finger double-tap undo vs. 2-finger pan/pinch/rotate
  | 'TOUCH_2_NAVIGATING'                  // 2-Finger pan, pinch-zoom (10%-3200%), and rotate
  | 'LASSO_ACTIVE_AWAITING_GLYPH'         // Selection active; checks if next stroke is '?'
  | 'DRAWER_TOUCH_SCROLL_ZOOM'            // Side-drawer: Finger scrolls/zooms PDF or Chat
  | 'DRAWER_PEN_SMART_SELECTING'          // Side-drawer: S-Pen Lasso or Vertical Bracket `[` selection
  | 'DRAWER_SELECTION_READY'              // Side-drawer: Selection active; next touch inside drags, outside deselects
  | 'DRAWER_SELECTION_DRAGGING_TO_CANVAS';// Side-drawer: Finger or S-Pen dragging active selection to Canvas

export type GestureEvent =
  | { type: 'PEN_DOWN'; target: 'CANVAS' | 'DRAWER'; insideDrawerSelection?: boolean; tool: 'pen' | 'eraser' | 'lasso' | 'laser'; x: number; y: number }
  | { type: 'PEN_UP'; recognizedGlyph?: '?' | 'CLOSED_CIRCLE_HOLD_LASSO' | 'CLOSED_CIRCLE_GROUP' | null }
  | { type: 'TOUCH_START'; target: 'CANVAS' | 'DRAWER'; insideDrawerSelection?: boolean; touches: Array<{ id: number; x: number; y: number }> }
  | { type: 'TOUCH_MOVE_BEYOND_SLOP' }
  | { type: 'TOUCH_HOLD_TIMEOUT' }        // Fires after 500ms stationary 1-finger hold (<=8px slop)
  | { type: 'TWO_FINGER_DOUBLE_TAP' }     // Triggers UndoCommand
  | { type: 'THREE_FINGER_TAP' }          // Triggers RedoCommand
  | { type: 'THREE_FINGER_SWIPE' }        // Toggles Split-Screen Research Drawer
  | { type: 'TOUCH_END'; remainingTouches: number };

export function gestureReducer(state: GestureState, event: GestureEvent): GestureState {
  switch (state) {
    case 'IDLE':
      if (event.type === 'PEN_DOWN' && event.target === 'DRAWER') return 'DRAWER_PEN_SMART_SELECTING';
      if (event.type === 'PEN_DOWN' && event.tool === 'eraser') return 'PEN_STROKE_ERASING';
      if (event.type === 'PEN_DOWN' && event.tool === 'laser') return 'PEN_TEACHING_LASER';
      if (event.type === 'PEN_DOWN') return 'PEN_DRAWING';
      if (event.type === 'TOUCH_START' && event.target === 'DRAWER') return 'DRAWER_TOUCH_SCROLL_ZOOM';
      if (event.type === 'TOUCH_START' && event.touches.length === 1) return 'TOUCH_1_PENDING';
      if (event.type === 'TOUCH_START' && event.touches.length === 2) return 'TOUCH_2_PENDING_TAP_OR_NAV';
      return state;

    case 'TOUCH_1_PENDING':
      // Bimanual shortcut: 1-finger down + S-Pen down triggers AI Autoresearch Lasso
      if (event.type === 'PEN_DOWN') return 'TOUCH_HOLD_PEN_AI_LASSOING';
      // Immediate 1-finger drag (<0.5s) is ignored as palm-safe no-op (camera only pans with 2 fingers)
      if (event.type === 'TOUCH_MOVE_BEYOND_SLOP') return 'IDLE';
      if (event.type === 'TOUCH_HOLD_TIMEOUT') return 'TOUCH_HOLD_MODIFIER';
      if (event.type === 'TOUCH_START' && event.touches.length === 2) return 'TOUCH_2_PENDING_TAP_OR_NAV';
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;

    case 'TOUCH_HOLD_MODIFIER':
      // Once held >=0.5s: dragging finger >8px performs Finger Lasso; S-Pen down performs AI Autoresearch Lasso
      if (event.type === 'TOUCH_MOVE_BEYOND_SLOP') return 'TOUCH_LASSOING';
      if (event.type === 'PEN_DOWN') return 'TOUCH_HOLD_PEN_AI_LASSOING';
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;

    case 'TOUCH_LASSOING':
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'LASSO_ACTIVE_AWAITING_GLYPH';
      return state;

    case 'TOUCH_HOLD_PEN_AI_LASSOING':
      // On PEN_UP, immediately dispatches AI Autoresearch job on lassoed strokes and returns to IDLE
      if (event.type === 'PEN_UP') return 'IDLE';
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;

    case 'TOUCH_2_PENDING_TAP_OR_NAV':
      if (event.type === 'TWO_FINGER_DOUBLE_TAP') return 'IDLE'; // Dispatches UndoCommand
      if (event.type === 'TOUCH_MOVE_BEYOND_SLOP') return 'TOUCH_2_NAVIGATING';
      if (event.type === 'TOUCH_END' && event.remainingTouches === 0) return 'IDLE';
      return state;

    case 'LASSO_ACTIVE_AWAITING_GLYPH':
      // If user draws '?' inside/near active lasso, trigger AI search and return to IDLE
      if (event.type === 'PEN_UP' && event.recognizedGlyph === '?') return 'IDLE';
      if (event.type === 'TOUCH_START' || event.type === 'PEN_DOWN') return 'IDLE';
      return state;

    case 'PEN_DRAWING':
      // Closed circle + Pen Hold (>= holdThresholdMs) -> ephemeral Auto-Lasso
      if (event.type === 'PEN_UP' && event.recognizedGlyph === 'CLOSED_CIRCLE_HOLD_LASSO') {
        return 'LASSO_ACTIVE_AWAITING_GLYPH';
      }
      // Closed circle + Immediate Lift ('CLOSED_CIRCLE_GROUP') or normal stroke -> keeps ink & returns to IDLE
      if (event.type === 'PEN_UP') return 'IDLE';
      return state;

    case 'DRAWER_PEN_SMART_SELECTING':
      if (event.type === 'PEN_UP') return 'DRAWER_SELECTION_READY';
      return state;

    case 'DRAWER_SELECTION_READY':
      // Next touch or S-Pen inside the selected region drags it to the main canvas; outside deselects
      if ((event.type === 'PEN_DOWN' || event.type === 'TOUCH_START') && event.insideDrawerSelection) {
        return 'DRAWER_SELECTION_DRAGGING_TO_CANVAS';
      }
      if (event.type === 'PEN_DOWN' && event.target === 'DRAWER') return 'DRAWER_PEN_SMART_SELECTING';
      if (event.type === 'TOUCH_START' && event.target === 'DRAWER') return 'DRAWER_TOUCH_SCROLL_ZOOM';
      if (event.type === 'PEN_DOWN' || event.type === 'TOUCH_START') return 'IDLE';
      return state;

    default:
      if (event.type === 'PEN_UP' || (event.type === 'TOUCH_END' && event.remainingTouches === 0)) {
        return 'IDLE';
      }
      return state;
  }
}
```

### 5.4 Command Pattern: Atomic Canvas & Zettelkasten Mutations
Every mutation is an undoable transaction triggered or reverted via `2-Finger Double-Tap` (or the Radial Wheel Undo/Redo slots).

```typescript
// src/core/commands/canvas_command.ts
export interface CanvasCommand {
  readonly id: string;
  readonly description: string;
  execute(db: DatabaseSession): Promise<void>;
  undo(db: DatabaseSession): Promise<void>;
}

/**
 * Samsung Notes-style Whole-Stroke Eraser Command
 */
export class StrokeEraseCommand implements CanvasCommand {
  readonly id = crypto.randomUUID();
  readonly description = 'Erase intersected vector strokes';
  private deletedStrokesBackup: SpatialNodeRow[] = [];

  constructor(private readonly intersectedStrokeIds: string[]) {}

  async execute(db: DatabaseSession): Promise<void> {
    this.deletedStrokesBackup = await db.spatialNodes.findByIds(this.intersectedStrokeIds);
    await db.spatialNodes.deleteBatch(this.intersectedStrokeIds);
  }

  async undo(db: DatabaseSession): Promise<void> {
    await db.spatialNodes.insertBatch(this.deletedStrokesBackup);
  }
}

/**
 * Non-Destructive Heading Atomization Command (Splits `#`, `##`, `###` sections into linked Vault Zettels
 * while keeping original handwriting anchored in place on the canvas page)
 */
export class CommitAtomizationCommand implements CanvasCommand {
  readonly id = crypto.randomUUID();
  readonly description = 'Commit # / ## / ### sections into hierarchically & causally linked Atomic Zettels';
  private createdZettelIds: string[] = [];
  private createdLinkIds: string[] = [];

  constructor(
    private readonly pageId: string,
    private readonly sections: Array<{
      headingClusterId: string;
      bodyClusterIds: string[];
      headingLevel: 1 | 2 | 3;
      confirmedTitle: string;
      summaryMarkdown: string; // Includes compiled `-->`, `{ }`, `vs.` tables, and `↻ Cycle` blocks
      parentSectionIndex?: number;
      causalTargetSectionIndices?: number[]; // From drawn `-->` arrows between `#`/`##` sections
    }>
  ) {}

  async execute(db: DatabaseSession): Promise<void> {
    // Creates individual Zettel records anchored to `headingClusterId` & `pageId`
    // and links them hierarchically (`parent_of` / `child_of`) and causally (`causes`).
    const result = await db.zettels.atomizePageSections(this.pageId, this.sections);
    this.createdZettelIds = result.zettelIds;
    this.createdLinkIds = result.linkIds;
  }

  async undo(db: DatabaseSession): Promise<void> {
    await db.zettels.deleteLinksBatch(this.createdLinkIds);
    await db.zettels.deleteBatch(this.createdZettelIds);
  }
}
```

### 5.5 AI Agent & Syntax Tool Contract
When the local Syntax Parser or Cloud VLM proposes Zettel operations, it interacts strictly through typed Zod schemas (`src/ai/agent_contract.ts`):

```typescript
// src/ai/agent_contract.ts
import { z } from 'zod';

/**
 * Tool 1: Propose or Auto-Commit Hierarchical Atomization from `#`, `##`, `###` Page Sections
 * (In Confirm-on-Tap mode, anchors passive `⚛` icon; in Auto-Atomize mode, executes `CommitAtomizationCommand`)
 */
export const HeadingAtomizationToolSchema = z.object({
  pageId: z.string().uuid(),
  parentNoteTitle: z.string(), // e.g., "Ngũ Hành"
  detectedSections: z.array(
    z.object({
      headingClusterId: z.string().uuid(),
      bodyClusterIds: z.array(z.string().uuid()), // Scoped via Column-Flow + `-->` / `{ }` connectors
      sectionBbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // For dashed preview on `⚛` tap
      headingLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]), // #, ##, ###
      extractedTitle: z.string().min(1).max(80), // e.g., "Kim", "Mộc", "Thủy", "Hỏa", "Thổ"
      summaryMarkdown: z.string(), // Compiled Markdown with `{}` lists, `vs.` tables, `-->` chains & `↻ Cycle`
      recognizedStructures: z.array(
        z.enum(['arrow_chain', 'brace_group', 'comparison_table', 'loop_cycle'])
      ),
      parentSectionIndex: z.number().int().optional(), // Links ## under #
      causalTargetSectionIndices: z.array(z.number().int()).optional(), // From `-->` between headings
    })
  ),
});

/**
 * Tool 2: Resolve or Flag `[[WikiLink]]` Syntax
 */
export const WikiLinkResolutionSchema = z.object({
  clusterId: z.string().uuid(),
  rawBracketText: z.string(), // Text inside [[__]]
  resolutionState: z.enum(['exact_match', 'ambiguous_multiple', 'not_found']),
  highlightColor: z.enum(['cobalt', 'crimson']), // Cobalt -> Peek Popover; Crimson -> Dropdown + Create & Jump
  candidateZettels: z.array(
    z.object({
      zettelId: z.string().uuid(),
      title: z.string(),
      similarityScore: z.number().min(0).max(1),
    })
  ),
});

/**
 * Tool 3: Update Async Job Badge & Route Thread to Side-Drawer AI Chat
 */
export const UpdateJobBadgeToolSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['completed', 'failed']),
  badgeState: z.enum(['verified', 'conflict', 'hint_available', 'atomize_ready']),
  drawerChatThreadId: z.string().uuid(), // Tapping `● Ready` opens AI Chat Drawer scrolled to this thread
  summaryHeadline: z.string().max(140),
  linkedZettelId: z.string().uuid().optional(),
});
```

---

## 6. Database Schema (SQLite + `sqlite-vec` + Auto-Synced R-Tree)

> **CRITICAL SQLITE INVARIANT:** SQLite `rtree` virtual tables require a 64-bit signed `INTEGER` primary key. Therefore, `spatial_nodes_rtree.id` maps directly to `spatial_nodes.rowid` via automatic SQL triggers. Never insert UUID strings into `spatial_nodes_rtree.id`.

```sql
-- 1. Canvases, User Settings, Structured Pages & Smart/Custom Layers
CREATE TABLE IF NOT EXISTS canvases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    camera_state_json TEXT NOT NULL, -- { panX, panY, zoom, rotation, isZoomLocked }
    drawer_config_json TEXT NOT NULL DEFAULT '{"side":"right","widthRatio":0.35,"isOpen":false}',
    settings_json TEXT NOT NULL DEFAULT '{"atomizationMode":"confirm_on_tap","parseMode":"auto","circleLassoHoldMs":300}',
    updated_at INTEGER NOT NULL
);

-- Enforces page-by-page arrangement on top of the infinite canvas
-- `page_group_id` binds multiple pages together when strokes extend across page boundaries
CREATE TABLE IF NOT EXISTS canvas_pages (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    page_group_id TEXT, -- Non-null when cross-boundary strokes attach 2+ pages into a Multi-Page Note
    page_index INTEGER NOT NULL,
    title TEXT,
    min_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_x REAL NOT NULL,
    max_y REAL NOT NULL,
    template_type TEXT NOT NULL DEFAULT 'dot_grid' CHECK(template_type IN ('blank', 'dot_grid', 'lined', 'cornell')),
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS layers (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    layer_type TEXT NOT NULL CHECK(layer_type IN ('presentation', 'ai_layer', 'draft_ink', 'reference', 'custom')),
    z_index INTEGER NOT NULL,
    is_visible INTEGER NOT NULL DEFAULT 1,
    is_locked INTEGER NOT NULL DEFAULT 0,
    opacity REAL NOT NULL DEFAULT 1.0
);

-- 2. Spatial Nodes (Single source of truth for all canvas items)
CREATE TABLE IF NOT EXISTS spatial_nodes (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    page_id TEXT REFERENCES canvas_pages(id) ON DELETE SET NULL,
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL CHECK(node_type IN (
        'vector_stroke', 'stroke_cluster', 'grouped_container', 'structural_connector',
        'zettel_card', 'pdf_snippet', 'object_instance', 'wikilink_token', 'agenda_task'
    )),
    parent_cluster_id TEXT REFERENCES spatial_nodes(id) ON DELETE SET NULL,
    heading_level INTEGER CHECK(heading_level IN (1, 2, 3)), -- 1 for '#', 2 for '##', 3 for '###'
    wikilink_state TEXT CHECK(wikilink_state IN ('resolved', 'ambiguous_or_missing')), -- Cobalt vs Crimson Red
    task_completed INTEGER CHECK(task_completed IN (0, 1)), -- Bidirectional `[ ]` (0) <-> `[x]` (1) Agenda state
    min_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_x REAL NOT NULL,
    max_y REAL NOT NULL,
    stroke_points BLOB,
    style_json TEXT,
    content_json TEXT,
    ocr_text TEXT,
    semantic_tags_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 3. R-Tree Spatial Index (64-bit integer id synced to spatial_nodes.rowid)
CREATE VIRTUAL TABLE IF NOT EXISTS spatial_nodes_rtree USING rtree(
    id, min_x, max_x, min_y, max_y
);

CREATE TRIGGER IF NOT EXISTS sync_rtree_insert AFTER INSERT ON spatial_nodes BEGIN
    INSERT INTO spatial_nodes_rtree(id, min_x, max_x, min_y, max_y)
    VALUES (new.rowid, new.min_x, new.max_x, new.min_y, new.max_y);
END;

CREATE TRIGGER IF NOT EXISTS sync_rtree_update AFTER UPDATE OF min_x, min_y, max_x, max_y ON spatial_nodes BEGIN
    UPDATE spatial_nodes_rtree
    SET min_x = new.min_x, max_x = new.max_x, min_y = new.min_y, max_y = new.max_y
    WHERE id = new.rowid;
END;

CREATE TRIGGER IF NOT EXISTS sync_rtree_delete AFTER DELETE ON spatial_nodes BEGIN
    DELETE FROM spatial_nodes_rtree WHERE id = old.rowid;
END;

-- 4. Async Job Queue & Badge Status
CREATE TABLE IF NOT EXISTS async_jobs (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    anchor_node_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK(job_type IN (
        'cluster_ocr', 'verify_claim', 'lasso_question_search', 'bimanual_ai_lasso',
        'propose_atomization', 'resolve_wikilink'
    )),
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'awaiting_user_acceptance', 'completed', 'failed')),
    drawer_chat_thread_id TEXT, -- Routes `● Ready` badge tap straight to Side-Drawer AI Chat thread
    result_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 5. Zettelkasten Knowledge Graph (Atomic Notes & Hierarchical/Causal/Lateral Links)
CREATE TABLE IF NOT EXISTS zettels (
    id TEXT PRIMARY KEY,
    spatial_node_id TEXT UNIQUE REFERENCES spatial_nodes(id) ON DELETE SET NULL,
    source_page_id TEXT REFERENCES canvas_pages(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary_markdown TEXT NOT NULL, -- Includes compiled `-->`, `{ }`, `vs.` tables, and `↻ Cycle` blocks
    original_ink_snapshot_blob BLOB,
    heading_level INTEGER CHECK(heading_level IN (1, 2, 3)),
    verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK(verification_state IN ('unverified', 'verified', 'conflict', 'hint')),
    embedding F32_BLOB(384), -- 384-dim all-MiniLM-L6-v2
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS zettel_links (
    id TEXT PRIMARY KEY,
    source_zettel_id TEXT NOT NULL REFERENCES zettels(id) ON DELETE CASCADE,
    target_zettel_id TEXT NOT NULL REFERENCES zettels(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK(relation_type IN (
        'parent_of',      -- Up/Down one level from '#' -> '##' -> '###'
        'child_of',       -- Down/Up one level from '###' -> '##' -> '#'
        'causes',         -- Drawn arrow `-->` between `#`/`##` headings or `Page A --> Page B`
        'wikilink',       -- Explicit handwritten [[Note Name]] call
        'supports',
        'contradicts',
        'related'
    )),
    confidence REAL NOT NULL DEFAULT 1.0,
    UNIQUE(source_zettel_id, target_zettel_id, relation_type)
);

-- 6. User Object Store (Reusable Sketches, Drawings & Primitives)
CREATE TABLE IF NOT EXISTS object_store_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'user_sketch' CHECK(category IN ('user_sketch', 'diagram_primitive', 'stamp')),
    serialized_strokes_blob BLOB NOT NULL,
    thumbnail_svg TEXT,
    width REAL NOT NULL,
    height REAL NOT NULL,
    created_at INTEGER NOT NULL
);
```

---

## 7. Phased Implementation Roadmap & Evaluation Gates

```
+-----------------------------------------------------------------------------+
| PHASE 0: S-PEN INK FOUNDATION, PAGE GRID & CONCEPTS WHEEL (Weeks 1 - 4)     |
| Deliverable: Jetpack Ink / WebGL2 Wet-Dry Scene Graph + Page-on-Infinite    |
|              Canvas + 9-Slot Concepts Radial Wheel (Per-Tool Memory) +      |
|              Default Stroke Eraser + 2-Finger Nav / 1-Finger Hold Lasso &   |
|              2-Finger Double-Tap Undo.                                      |
| Evaluation Gate #0: 15 mins of note-taking on Galaxy Tab S-Pen with <4ms    |
|                     latency, zero badge drift, and instant stroke erasing.  |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 1: OCR, SMART SYMBOLS (`[[]]`, `#`, `?`, DIAGRAMS) & VAULT (Wks 5-10) |
| Deliverable: Tier 0/1 Graph Solver & Incremental OCR (Auto & 1-Click Modes) |
|              + Circle-Group vs Hold-Lasso + `[[WikiLink]]` (Cobalt Peek /   |
|              Crimson Dropdown & Create-Jump) + `#`/`##`/`###` Atomizer +    |
|              `-->`, `{ }`, `vs.`, Loop-Cycles to Markdown.                  |
| Evaluation Gate #1: Writing a "Ngũ Hành" note with 5 `##` sections and a    |
|                     cycle diagram compiles into 5 linked Atomic Zettels.    |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 2: BIMANUAL SIDE-DRAWER (PDF + AI CHAT) & OBJECT STORE (Weeks 11 - 16)|
| Deliverable: Left/Right Dockable Drawer + Finger Scroll/Zoom vs. S-Pen      |
|              Smart-Select (Lasso & Vertical Bracket) + Next-Touch Drag for  |
|              PDFs & AI Chat + Live Vector Object Store + Bidirectional `[ ]`|
| Evaluation Gate #2: User scrolls PDF with finger, bracket-selects & drags   |
|                     3 quotes/diagrams onto page, and reuses 2 sketches.     |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 3: ZETTEL GRAPH, GHOST LINKS & TEACHING MODE (Weeks 17 - 22)          |
| Deliverable: Tier 2/3 Embeddings & Ghost Links + Presentation Layer toggle  |
|              (1-Tap Promote + Zettel Card Drop) + Dual Teaching Laser /     |
|              Spotlight Dimmer + Multi-Page PDF Export.                      |
| Evaluation Gate #3: User navigates multi-level Zettel graph and delivers    |
|                     a 10-min presentation directly from the canvas.         |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 4: PERFORMANCE SPRINT & ANDROID BETA LAUNCH (Weeks 23 - 28)           |
| Deliverable: 10,000+ vector stroke R-Tree profiling + Beta rollout.         |
| Evaluation Gate #4: 50 active S-Pen beta testers; 14-day retention > 40%.   |
+-----------------------------------------------------------------------------+
```

---

## 8. Agentic AI Coding Team Playbook (Instructions for AI Agents)

When an autonomous AI coding agent begins working in this repository:

1. **Check System Boundaries:** Read `docs/ARCHITECTURE.md` and `docs/repo-map.json` before modifying files across layers.
2. **Respect the SQLite R-Tree Invariant:** Always query `spatial_nodes_rtree` by joining `spatial_nodes.rowid = spatial_nodes_rtree.id`. Never manually insert into `spatial_nodes_rtree` (let the SQL triggers handle it).
3. **Preserve Handwritten Syntax & Atomization Rules:**
   * Support both `confirm_on_tap` (default passive `⚛` badge for title confirmation, never an intrusive popup) and `auto_atomize` modes from `settings_json`, always keeping the original handwritten ink non-destructively anchored in place on the page.
   * Compile `-->`, `{ }`, `vs.`, and Loop-Cycles (`A → B → C → A`) into clean Markdown primitives and causal `zettel_links` (`causes`).
   * Render resolved `[[__]]` links in `Cobalt Blue` (opening the non-jarring Peek Popover on tap) and unresolved/ambiguous links in `Crimson Red` (`#DC2626`, opening the fuzzy-match dropdown + `+ Create Empty Zettel & Jump` on tap).
4. **Enforce Hardware Pointer & Bimanual Separation:**
   * On the Main Canvas (`gesture_fsm.ts`), camera pan/zoom/rotate requires **2 fingers**; immediate 1-finger move (`<0.5s`) is a palm-safe no-op; `1-Finger Hold (>=0.5s) + Finger Drag` is Finger Lasso; `1-Finger Hold + S-Pen Lasso` triggers AI Autoresearch.
   * Inside the Side Drawer, `pointerType === 'touch'` scrolls/zooms while `pointerType === 'pen'` performs Smart Select (Lasso or Vertical Bracket `[`), and the very next touch/stylus inside the selection drags it onto the canvas (`Reference Layer`), while touching outside deselects.
5. **Default Eraser & Per-Tool Memory Invariant:** Ensure the Eraser tool slot on the Radial Wheel initializes in `stroke_eraser` mode (deleting whole strokes on contact) and that `Primary Pen`, `Secondary Pen`, and `Sketch Marker` each maintain independent color and stroke-width memory.
6. **Run Headless Harness First:** Run `npm run test:headless` to verify that `gesture_fsm`, `CanvasCommand` undo/redo, and R-Tree spatial queries pass 100% before touching UI components.
