# NoteFlow: Product Vision, UI/UX Specification & System Architecture
**Document Version:** 1.0 (Planning & Architecture Review Phase)  
**Target Platforms:** Tablet-First (iPadOS + Apple Pencil, Android Galaxy Tab + S-Pen)  
**Primary Input Modality:** Zero-Keyboard Bimanual Input (Stylus + Multi-Touch + Voice)

---

## 1. Executive Summary & Core Vision

### 1.1 Problem Statement
Tablet users who rely on handwriting for deep thinking face a "Split-Screen Tax." Standard handwriting apps (Samsung Notes, Goodnotes, Concepts) offer superior pen ergonomics and spatial freedom but act as "dumb" storage. Conversely, AI assistants and Personal Knowledge Management (PKM) systems (Obsidian, Heptabase, NotebookLM, Claude) excel at synthesis and atomic knowledge retrieval but are strictly keyboard- and text-block-centric. Switching between them breaks cognitive flow.

### 1.2 The NoteFlow Solution
**NoteFlow** is a **Stylus-First, AI-Native Spatial Zettelkasten**. It combines the tactile, vector-based ergonomic UI of the **Concepts App** with an unobtrusive, asynchronous AI research agent and a multimodal Zettelkasten database.

### 1.3 Core Use Cases
1. **Brainstorm & Plan (Divergent Mode):** Freeform handwriting, sketchnoting, graphing ideas, and managing ink-native tasks/calendars on an infinite canvas.
2. **Learn & Deep Research (Absorptive Mode):** Reading PDFs/sources in a slide-over drawer, extracting snippets onto the canvas, running non-blocking background fact-checks/research via ink gestures, and letting the AI synthesize context in the background.
3. **Synthesize & Teach (Convergent Mode):** Distilling messy boards into permanent, atomic Zettelkasten cards (via Socratic AI clarification) and using smart canvas layers + laser tools to explain/teach concepts to others.

---

## 2. UI/UX Design Specification (The "Concepts App" Foundation)

NoteFlow adopts the proven ergonomic patterns of the **Concepts App**—specifically its bimanual (two-handed) touch-and-stylus workflow, vector object manipulation, radial tool wheel, layer stack, and object library—while stripping away complex artistic bloat (hundreds of COPIC colors and textures) in favor of a streamlined **Learning & Notetaking** toolset.

### 2.1 The Radial Tool Wheel (Simplified & Dockable)
Instead of a top ribbon that requires reaching across the screen, NoteFlow uses a **floating or edge-dockable Radial Tool Wheel** operable by the non-dominant thumb or stylus tap:
* **6 Core Tool Slots (Outer Ring):**
  1. **Fine Pen:** Pressure-sensitive vector ink for crisp handwriting.
  2. **Sketch Marker:** Chisel/brush tip for headers, boxes, and diagram containers.
  3. **Smart Highlighter:** Renders *underneath* ink strokes; doubles as an asynchronous AI trigger based on color/gesture.
  4. **Smart Picker / Magic Lasso:** Selects vector strokes, PDF snippets, and cards. Includes a contextual radial action menu (`Move/Scale`, `Nudge`, `? Verify`, `✦ Explore`, `📊 Graph`, `⚛ Atomize`).
  5. **Vector Eraser:** Toggle between *Stroke Eraser* (tapping removes whole vector stroke) and *Slice Eraser* (cuts through vector lines cleanly).
  6. **Teaching Laser / Spotlight:** Disappearing ink + canvas dimmer for explaining diagrams to others.
* **Preset Size & Semantic Palette (Inner Ring):**
  * **3 Quick Stroke Widths:** Fine (writing), Medium (diagrams), Thick (dividers).
  * **6 Semantic Ink Colors (No Color Wheel Bloat):**
    * *Ink Black/White* (Primary writing)
    * *Cobalt Blue* (Secondary notes / annotations)
    * *Crimson Red* (Critique / questions / emphasis)
    * *Forest Green* (Examples / evidence)
    * *Amber Gold* (Highlighter: Key takeaway)
    * *Violet* (AI Semantic Highlighter: Triggers background fact-check/research)

### 2.2 Bimanual Smart Gestures (Stylus + Finger)
Strict hardware separation between `pointerType === 'pen'` and `pointerType === 'touch'`:
* **1-Finger Drag (Canvas):** Pan canvas (strict palm rejection when stylus is within hover range).
* **2-Finger Pinch / Rotate:** Smooth 120Hz zoom and canvas rotation (with snap-to-0°).
* **2-Finger Tap:** Undo.
* **3-Finger Tap:** Redo.
* **1-Finger Hold on Canvas + Stylus Action (Modifier Pattern):**
  * *Hold 1 Finger + Draw with Stylus:* Temporarily activates **Magic Lasso** without switching tools on the wheel.
  * *Hold 1 Finger + Speak:* Activates **Push-to-Talk Voice Prompt** scoped to whatever the stylus is pointing at or circling.
* **3-Finger Swipe Left/Right:** Toggle the Split-Screen Research & Source Drawer.

### 2.3 Hybrid Canvas: Infinite Space + Page Artboards
* **Infinite Plane:** Default workspace is an infinite, zoomable 2D plane with configurable grids (Dot, Graph, Lined, Isometric).
* **Artboard / Page Overlays:** Users can toggle fixed page boundaries (e.g., 16:9 Teaching Slides or A4 Pages) inside the infinite canvas. Messy research can live *outside* the artboard margins, while clean diagrams sit *inside* the frames for structured teaching or PDF export.

### 2.4 Smart Layers (Concepts-Style Stack)
A floating, collapsible Layer Pill allows scrubbing through layers, adjusting opacity, locking, or hiding:
* **Auto-Layering Mode:** Optionally routes tools to dedicated layers automatically (e.g., PDF Snippets $\rightarrow$ *Reference Layer*; Messy Ink $\rightarrow$ *Draft Layer*; AI Outputs $\rightarrow$ *AI Layer*; Clean Diagrams $\rightarrow$ *Presentation Layer*).
* **Teaching Mode Toggle:** One tap hides the *Reference* and *Draft* layers, leaving only the *Presentation Layer* visible.

### 2.5 The "Object & Zettel Store" (Concepts Object Library Evolution)
In Concepts, users have a pop-out **Object Library** of draggable vector shapes. NoteFlow evolves this into a 3-tab **Spatial Object & Zettel Store**:
1. **Primitives Tab:** Draggable vector templates for notetaking (flowchart nodes, Cartesian axes, comparison tables, callout boxes, mind-map branches).
2. **Zettel Vault Tab:** Searchable library of the user's permanent **Atomic Zettelkasten Cards** (showing both their original cropped handwriting snapshot and AI-synthesized summary). Any Zettel can be dragged onto the current canvas as a linked reference node.
3. **Inbox / Async Tray:** Completed background AI outputs (verified facts, generated charts, web clippings) waiting to be dragged onto the canvas.
* *Bi-Directional Saving:* Users can lasso any custom sketch on the canvas and drag it *into* the Object Store to reuse across canvases or trigger Atomization.

### 2.6 Split-Screen Research Drawer
A resizable right-hand panel that coexists with the canvas:
* **Exploration Mode:** Houses comprehensive AI research reports, deep explanations, and Socratic Q&A threads.
* **Source Reader (PDF / Web):** Houses uploaded PDFs and web articles.
* **Liquid Extraction:** Users can highlight text or drag a rectangle over a chart in the PDF/AI panel with their finger or stylus and drag it directly across the divider onto the canvas. It lands as a vector/image node with an unbreakable **Citation Tether** back to the exact PDF page or AI thread.

---

## 3. Core AI & Knowledge Management Workflows

### 3.1 Periodic Canvas Context Daemon ("The Heartbeat")
* **Mechanism:** Runs silently in the background. After $N$ seconds of pen inactivity (or every $X$ strokes), it computes the bounding box of modified vector strokes, renders a lightweight raster tile, and passes both the image and existing node metadata to a Vision-Language Model (VLM).
* **Output:** Maintains a live JSON `CanvasContextState` representing the current topics, hierarchical structure, drawn arrows, handwritten `[ ]` tasks, and `@date` calendar items on the board.

### 3.2 Fire-and-Forget Asynchronous Ink Tasks & Status Badges
To preserve handwriting flow, AI commands triggered on the canvas do **not** block the user with loading modals:
1. **Trigger:** User underlines a handwritten claim with the *Violet AI Highlighter* or lassos a section and taps `? Verify` / `📊 Graph`.
2. **Non-Blocking Queue:** A tiny vector badge (`◌ Queued` $\rightarrow$ `🔄 Running`) anchors to the top-right corner of that ink cluster. The user immediately continues writing elsewhere.
3. **Completion (`● Ready`):** Once the background worker finishes searching the web, verifying against uploaded PDFs, or generating a chart, the badge glows (`Green` = Verified, `Amber` = Disputed/Nuance found, `Blue` = Data/Graph ready).
4. **Inspection:** The user taps the badge whenever they are ready (minutes or hours later) to inspect the result in a popover or the Split-Screen Drawer, and drags relevant cards/charts onto the canvas.

### 3.3 Direct Agent Canvas Mutation
When explicitly commanded (via voice modifier or drawer prompt, e.g., *"Plot a supply-demand curve next to my notes"* or *"Organize these brainstorm clusters into a clean mind map"*), the AI agent executes bounded canvas mutation tool calls to place vector diagrams, cards, and arrows directly onto the canvas (always on the *AI Layer* or as an undoable transaction).

### 3.4 Ghost Links & Socratic Zettelkasten Synthesis
* **Ghost Links (Proactive Retrieval):** As the Heartbeat Daemon updates `CanvasContextState`, a local vector search queries the user's existing Zettelkasten database. If a strong semantic match is found, a subtle translucent **Ghost Card** pulses at the screen edge. The user can drag it onto the canvas to link past knowledge with current thinking, or ignore it.
* **Socratic Atomization:** When the user triggers `⚛ Atomize` on a canvas cluster (or wraps up a study session), the AI does not blindly auto-generate a note. Instead, it acts as a **Socratic Editor** in the drawer—asking 1–2 quick clarifying questions to ensure the user's core thesis is sharp and distinct before committing the **Atomic Zettel**.
* **Full Provenance ("Flip Card"):** Every committed Zettel stores:
  * *Front:* Clean title, atomic synthesis, tags, and the cropped snapshot of the original handwriting/sketch.
  * *Back (Flip gesture):* Time-travel provenance (link to the exact origin canvas state, PDF citation tethers, web references, and the Socratic Q&A log).

### 3.5 Continuous Gesture & Suggestion Feedback Loop (Local RLHF)
* When a user pauses after drawing a structural pattern (e.g., an empty table, a math equation, or a question mark), a subtle floating chip offers 1–2 predicted actions.
* Every interaction (`accepted`, `dismissed`, `modified`) is logged locally alongside the stroke signature and canvas context, allowing an on-device ranking model to adapt to the user's personal shorthand over time.

---

## 4. Responsiveness-First Engineering Architecture

### 4.1 Performance & Responsiveness Mandate (The 120Hz Rule)
Because NoteFlow is a handwriting-first application, **pen-to-pixel latency is the highest engineering priority**.
1. **Strict Thread Isolation:**
   * **UI / Ink Render Thread (120fps / <8.3ms budget):** Handles only stylus `PointerEvents` (using coalesced and predicted events), vector stroke tessellation, wet-ink canvas rendering, and pan/zoom matrix transforms.
   * **Background Worker Thread 1 (Local DB & Spatial Index):** Runs SQLite WASM / Native SQLite, R-Tree spatial indexing (for fast lasso hit-testing on 10,000+ strokes), and vector embedding searches.
   * **Background Worker Thread 2 (AI & Snapshot Daemon):** Handles offscreen canvas rasterization for the Heartbeat Daemon, network I/O to LLMs, PDF parsing, and Async Job Queue execution.
2. **Wet-Ink vs. Dry-Ink Pipeline:**
   * Active stylus strokes render on a top-level hardware-accelerated "Wet Ink" overlay layer using predictive stroke points (`getPredictedEvents()`).
   * On `pointerup`, the stroke is committed as a simplified Bézier/polyline vector object to the spatial scene graph ("Dry Ink").

### 4.2 System Architecture Diagram

+===================================================================================+
| MAIN THREAD: 120Hz INK & GESTURE ENGINE (<8ms) |
| |
| [PointerEvent Router] ---> (Pen) ----> [Wet-Ink Predictive Renderer (WebGL/Skia)]|
| | | (pointerup) |
| (Touch) v |
| v [Dry-Ink Vector Scene Graph & R-Tree] |
| [Bimanual Gesture State Machine] | |
| [Concepts Radial Wheel & Layers UI] [Split-Screen PDF & Object Store Drawer] |
+==================================================|================================+
| (Zero-Copy SharedArrayBuffer /
| Async Message Bridge)
+==================================================v================================+
| WORKER THREAD POOL: AI, OCR & LOCAL-FIRST STORAGE |
| |
| +-------------------------------+ +----------------------------------------+ |
| | 1. Heartbeat Context Daemon | | 2. Non-Blocking Async Job Queue | |
| | - Offscreen dirty-tile render | | - Manages ◌ -> 🔄 -> ● ink jobs | |
| | - VLM Context State synthesis | | - Web Search / Fact-Check / Chart Gen | |
| | - [ ] Task & @date parser | | - Emits badge state updates to UI | |
| +---------------+---------------+ +--------------------+-------------------+ |
| | | |
| v v |
| +-------------------------------+ +----------------------------------------+ |
| | 3. Socratic Zettel & Ghost | | 4. Local Storage Engine (SQLite + Vec) | |
| | - sqlite-vec similarity | | - Tables: canvases, spatial_nodes, | |
| | - Ghost Link edge notifier | | layers, async_jobs, zettels, | |
| | - Socratic Q&A state machine | | zettel_links, gesture_feedback_logs | |
| +-------------------------------+ +----------------------------------------+ |
+===================================================================================+\

### 4.3 Recommended Tech Stack & Reference Implementations

#### Option A: Hybrid WebGL/Canvas Stack (Fastest Iteration with AI Coding Agents)
* **Core Canvas & Scene Graph:** Custom TypeScript + React 19 + **`tldraw` SDK** (heavily customized UI removing default toolbars in favor of Concepts Radial Wheel) OR **`perfect-freehand` + PixiJS / WebGL** for raw vector rendering.
* **Native Wrapper:** **Capacitor (iOS & Android)** with native plugins for Apple Pencil / S-Pen hover, haptic feedback, and local SQLite.
* **PDF Engine:** `PDF.js` running in a dedicated Web Worker with a custom drag-and-drop extraction overlay.

#### Option B: Native Cross-Platform Skia Stack (Maximum Low-Level Ink Control)
* **Framework:** **Flutter (Impeller/Skia)** or **React Native (`@shopify/react-native-skia` + Reanimated worklets)**.
* **Reference Open-Source Architectures to Leverage:**
  * `penecho/penecho` (Pause-to-suggest ink RLHF, circle-to-knowledge-card, bounded agent canvas mutation tools).
  * `tldraw/agent-template` (Viewport inspection + direct spatial shape creation by LLMs).
  * `LinwoodDev/Butterfly` & `mathnotes-app/mobile-ink` (Low-latency tablet stylus pipelines, layer stacks, and presentation laser tools).

### 4.4 Core Database Schema (Local-First SQLite + `sqlite-vec`)

```sql
-- 1. Canvases
CREATE TABLE canvases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    grid_config JSON,              -- {type: 'dot', spacing: 20, artboard_preset: '16:9'}
    context_summary JSON,          -- Updated by Heartbeat Daemon
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Layers (Concepts-style stack)
CREATE TABLE layers (
    id TEXT PRIMARY KEY,
    canvas_id TEXT REFERENCES canvases(id),
    name TEXT NOT NULL,            -- 'Reference', 'Draft Ink', 'AI Layer', 'Presentation'
    z_index INTEGER NOT NULL,
    opacity REAL DEFAULT 1.0,
    is_visible BOOLEAN DEFAULT 1,
    is_locked BOOLEAN DEFAULT 0,
    auto_tool_binding TEXT         -- Optional: routes specific tools here automatically
);

-- 3. Spatial Nodes (Vector Strokes, Groups, PDF Snippets, Cards, Charts)
CREATE TABLE spatial_nodes (
    id TEXT PRIMARY KEY,
    canvas_id TEXT REFERENCES canvases(id),
    layer_id TEXT REFERENCES layers(id),
    node_type TEXT NOT NULL,       -- 'vector_stroke', 'stroke_group', 'pdf_snippet', 'ai_card', 'zettel_instance'
    bbox JSON NOT NULL,            -- {minX, minY, maxX, maxY, rotation, scale} (Indexed via SQLite R-Tree)
    vector_payload JSON,           -- Compressed points [{x,y,p,t}] or SVG/Image URI
    style_config JSON,             -- {color_semantic_id, stroke_width, brush_type}
    ocr_transcript TEXT,
    source_provenance JSON,        -- {pdf_id, page, rect, url, async_job_id}
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Asynchronous Background Jobs
CREATE TABLE async_jobs (
    id TEXT PRIMARY KEY,
    canvas_id TEXT REFERENCES canvases(id),
    anchor_node_id TEXT REFERENCES spatial_nodes(id),
    job_type TEXT NOT NULL,        -- 'verify', 'deep_research', 'generate_graph', 'atomize'
    status TEXT NOT NULL,          -- 'queued', 'running', 'completed', 'failed'
    badge_color TEXT,              -- 'green', 'amber', 'blue'
    input_snapshot_uri TEXT,
    result_payload JSON,           -- {summary, detailed_markdown, citations[], chart_spec}
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

-- 5. Zettelkasten Vault (Also powers the "Zettel Tab" in the Object Store)
CREATE TABLE zettels (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    atomic_statement TEXT NOT NULL,
    handwriting_snapshot_uri TEXT, -- Cropped vector/PNG of original handwritten sketch
    socratic_qa_log JSON,          -- Clarification Q&A that refined this idea
    source_provenance JSON,        -- Full snapshot of origin canvas, PDFs, chat history
    tags JSON,
    embedding BLOB,                -- sqlite-vec float[1536]
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Zettelkasten Graph Edges
CREATE TABLE zettel_links (
    source_id TEXT REFERENCES zettels(id),
    target_id TEXT REFERENCES zettels(id),
    relation_type TEXT,            -- 'supports', 'contradicts', 'extends', 'example_of'
    rationale TEXT,
    PRIMARY KEY (source_id, target_id)
);

-- 7. Gesture & Suggestion Feedback Loop (On-Device RLHF)
CREATE TABLE gesture_feedback_logs (
    id TEXT PRIMARY KEY,
    stroke_features JSON,          -- Aspect ratio, velocity, tool, color, pause_ms
    canvas_context_tag TEXT,
    suggested_action TEXT,
    user_response TEXT,            -- 'accepted', 'dismissed', 'overridden'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

# Others

4.5 AI Agent Tool-Calling Contract
The background and interactive AI agents interact with the workspace strictly through typed tools:
get_viewport_context(include_raster: boolean) 
→
→
 Returns CanvasContextState + active layer nodes + compressed WebP snapshot.
update_async_job_badge(job_id, status, badge_color, result_payload) 
→
→
 Updates the non-intrusive badge anchored to the user's ink.
mutate_canvas_layer(target_layer_id, operations: Array<CreateNode | MoveNode | CreateEdge>) 
→
→
 Writes structured diagrams, sticky notes, or reorganized layouts onto the AI Layer.
surface_ghost_zettel(zettel_id, relevance_score, anchor_bbox) 
→
→
 Triggers the edge-of-screen Ghost Link pulse.
initiate_socratic_atomizer(cluster_node_ids, draft_statement, clarifying_questions[]) 
→
→
 Opens the clarification UI in the drawer before saving to zettels.

## Some review rubric

1. Rendering & Responsiveness Architecture:
Evaluate Option A (Web/Capacitor + WebGL/Canvas2D) vs. Option B (Flutter/React Native Skia) specifically for maintaining <8ms stylus latency when a canvas grows to 10,000+ vector strokes, 30 high-res PDF snippets, and multiple active layers.
How should vector stroke grouping and R-Tree spatial indexing be structured so that when a user moves a handwritten paragraph, its anchored <AsyncStatusBadge /> and GhostLink tethers move seamlessly with it?

I see Concepts make it really smooth (well,basically every noteapp can handle great files now, what can we learn from those apps)

2. AI Context & Cost Optimization:
The Heartbeat Daemon periodically sends dirty canvas tiles to a VLM. What is the optimal diffing, tiling, and debouncing strategy to prevent excessive API token costs and battery drain during a 2-hour handwriting session?

3. Data Model & Zettelkasten Integrity:
Critique the SQLite schema (spatial_nodes, zettels, source_provenance). When a user edits or deletes an old canvas, how should historical provenance snapshots on committed Zettels be preserved without bloating local tablet storage?

