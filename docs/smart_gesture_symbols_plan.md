# NoteFlow — On-Device Smart Gesture & Symbol Recognition Plan (`ADR & Architecture Blueprint`)

**Date:** October 27, 2026  
**Status:** Approved Architecture Blueprint (Track 3 Intelligence Pipeline)  
**Design Priority:** **On-Device Accuracy > Speed** (`100ms–1500ms` asynchronous background worker budget; zero impact on `<4ms` main-thread wet ink)

---

## 1. Executive Summary & Design Philosophy

In natural tablet note-taking, handwriting is not merely passive prose—it is **diagrammatic, structural, and operational**. When a thinker writes on a spatial canvas, they use spatial gestures and inline symbols to encode structure and intent:
- **Spatial Enclosures & Emphasis:** Circling a word/phrase, single or double underlining.
- **Relational Connectors:** Drawing a pointing arrow (`A ───> B`) between two chunks of text or Zettel cards.
- **Structural Layouts:** Sketching a comparison table (grid lines or aligned columns/rows), ordered numbering (`1.`, `2.`, `a)`, `(i)`), and brackets (`[ ]` checkboxes, `{ }` vertical grouping braces, `( )` parenthetical citations).
- **Semantic Sigils:** `#` (topic tags), `?` (Socratic inquiry / verification trigger), `!` (critical insight / axiom), `@` (date deadlines / entity mentions), and `$` (LaTeX math compilation).

### Why Accuracy Over Speed Changes the Architecture
Because these gestures and symbols act as **background semantic signals**—instructing NoteFlow to index keywords, build relational edges between ideas in SQLite, or enqueue background AI jobs (`AsyncJobQueue`)—they **do not require `<1ms` synchronous execution on the UI thread**. A `100ms–1500ms` execution window inside a dedicated Web Worker after the `1200ms` Tier-0 idle debounce is completely imperceptible to the user while drawing at 120Hz.

Prioritizing **maximum on-device accuracy** reveals a critical insight:
1. **Why Pure Geometric Template Matching (`$1` / `$P+` / `$Q`) Fails as a Primary Engine:** Point-cloud template matchers only work on isolated, neatly drawn single/multi-stroke templates. In real notes, users write `#neuroscience`, `@tomorrow`, `$E=mc^2$`, or `1. First point` continuously on a line. Template matchers cannot segment inline symbols from cursive words or read the text *inside* a circled word or table cell (`~65%` real-world accuracy).
2. **Why Pure Raster OCR (`TrOCR` / `PP-OCRv4`) Alone Also Fails:** While neural OCR excels at reading inline text and sigils (`95–98%` accuracy), flattening strokes into a static bitmap destroys **stroke timestamps (`createdAt`)** and **SQLite R-Tree vector topology**. A pure image OCR model cannot reliably tell whether an oval drawn 10 seconds later *around* an existing word is a **Circle Gesture** or the letter `'O'`, nor can it trace a 900px curved arrow across the canvas to resolve its exact `source_node_id` and `target_node_id`.

### The Selected Decision: **Dual-Modality On-Device Pipeline (Spatio-Temporal Vector Topology + WebGPU/WASM Neural OCR & Vision)**
To achieve **95%+ accuracy** across both spatial gestures and messy handwritten symbols completely on-device:
- **Stage 1 (Spatio-Temporal Vector Topology Analyzer):** Operates on raw stride-4 `Float32Array` strokes (`[x, y, pressure, timestamp]`) and SQLite R-Tree queries to detect **Circles, Underlines, Pointing Arrows, Curly Braces `{ }`, and Table Grids**—and **masks out** those structural gesture strokes before passing the clean text crop to Stage 2 OCR.
- **Stage 2 (On-Device Neural Ink & Vision Worker via `Transformers.js` / `onnxruntime-web`):** Runs quantized local neural models (`TrOCR-handwritten` / `PP-OCRv4` for line/sigil transcription + `Florence-2-base-ft` `q4f16` for 2D math and table structure) inside a dedicated Web Worker using **WebGPU** (with automatic **WASM SIMD** fallback).
- **Stage 3 (Semantic Indexer & Action Dispatcher):** Parses the combined topological + neural output to update SQLite keyword salience, create `spatial_relations` / `zettel_links` edges, populate `agenda_tasks`, and enqueue `AsyncJobQueue` badges (`◌ → ↻ → ●`).

---

## 2. Comprehensive Comparison of Available On-Device Options

Because handwriting recognition models evolve rapidly and hardware capabilities vary across tablets (iPad Air/Pro M-series, Android Snapdragon tablets, Windows Surface), we evaluated **5 candidate architectures**. All candidates are wrapped behind a single pluggable interface (`InkRecognitionPort`) so we can benchmark or swap engines without touching `CanvasStore` or SQLite repositories.

| Option | Stack & Models | Inline Text & Sigil Accuracy (`# ? ! @ $ 1. [ ]`) | Spatial Gesture Accuracy (`Circle, Arrow, Underline, Table`) | Worker Latency (WebGPU / WASM) | On-Device Footprint (IndexedDB Cache) | Verdict & Role in NoteFlow |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **🥇 Option 1 (SELECTED PRIMARY)** | **Stage 1 R-Tree Vector Topology + Stage 2 `Transformers.js` (`PP-OCRv4` / `Xenova/trocr-base-handwritten` + `onnx-community/Florence-2-base-ft` `q4f16`)** | **⭐⭐⭐⭐⭐ (95–98%)** | **⭐⭐⭐⭐⭐ (96%+)** | `80–650ms` (WebGPU)<br>`300–1200ms` (WASM) | `~45MB` (HTR) + `~150MB` (Florence-2 `q4f16`) | **Primary Production Engine:** Highest combined accuracy on both messy inline sigils, 2D math/tables, and long-range spatial connectors. |
| **🥈 Option 2 (Fallback A — Stroke Sequence)** | **Stage 1 Vector Topology + Google ML Kit Digital Ink / `MathWriting` CTC-Transformer (`TFLite` / `ONNX` WASM)** on raw `(x, y, t)` sequences | **⭐⭐⭐⭐⭐ (95–97%)** | **⭐⭐⭐⭐ (92%+ with Stage 1)** | `30–90ms` (WASM) | `~18–25MB` per language + math pack | **Best Low-Memory Fallback:** Uses temporal stroke order directly without heavy vision encoders. Switch to this if a tablet lacks WebGPU or has `<4GB` RAM. |
| **🥉 Option 3 (Fallback B — Compact Edge VLM)** | **Stage 1 Vector Topology + `SmolVLM-256M-Instruct` or `Moondream2` (`q4f16` WebGPU) / Chrome Built-in `window.ai` (Gemini Nano)** | **⭐⭐⭐⭐ (90–94%)** | **⭐⭐⭐⭐⭐ (95%+ holistic)** | `600–1800ms` (WebGPU) | `~260–350MB` (`q4f16`) | **Tier-3 Escalation / Fallback B:** Best at semantic interpretation of messy comparison tables and ambiguous multi-arrow flowcharts. |
| **Option 4 (Test & Cold-Start Fallback)** | **Stage 1 Vector Topology + Pure TypeScript `$P+` / `$Q` Point-Cloud Template Recognizer** | **⭐⭐ (65–75% isolated symbols only)** | **⭐⭐⭐⭐ (90% geometric)** | `<2ms` (Main/Worker) | `0MB` (`<15KB` TS code) | **Headless Vitest Engine & Cold-Start Fallback:** Used in `<500ms` CI tests (`npm run test:headless`) and while neural weights download on first launch. |
| **Option 5 (Rejected for Core)** | **Proprietary Cloud / Commercial SDKs (MyScript iink SDK, Microsoft Ink Recognizer REST API)** | **⭐⭐⭐⭐⭐ (97%+)** | **⭐⭐⭐⭐⭐ (97%+)** | `300–900ms` (Network) | `0MB` local (Paid API / Closed Binary) | **Rejected for Core:** Violates offline-first privacy and open architecture; MyScript requires per-device commercial licensing. |

---

## 3. Detailed Architecture of the Selected Primary System (Option 1)

```text
+======================================================================================+
| MAIN THREAD (120Hz UI / <4ms Wet Ink — ZERO Neural Overhead)                         |
|  • User draws strokes -> CommitStrokeCommand -> SQLite spatial_nodes & R-Tree        |
|  • Tier0StrokeClusterer groups proximate strokes after 1200ms idle pause             |
|  • Emits ClusterUpdatedEvent(canvasId, layerId, clusterId, strokeRecords[])          |
+======================================================================================+
                                          │
                        [ Structured Clone / MessageChannel ]
                                          ▼
+======================================================================================+
| STAGE 1: SPATIO-TEMPORAL VECTOR TOPOLOGY ANALYZER (Pure TS in Worker, <5ms)          |
|  Operates on raw stride-4 Float32Array [x, y, p, t] + R-Tree AABB neighborhood:      |
|  1. Enclosure Detector: Winding angle |ΣΔθ| >= 1.75π + closed gap + R-Tree inner hit |
|  2. Underline Detector: Linearity > 0.92, |slope| < 0.18, 2–36px below word baseline |
|  3. Arrow Detector: Shaft skeleton + V-head reflex/2-stroke tip + R-Tree raycast     |
|  4. Table Grid Detector: H-lines × V-lines intersections OR 2D X/Y projection gutters|
|  5. Bracket & Bullet Geometry: Leading [ ] box, tall { } cusp brace, hanging indent  |
|  *CRITICAL STEP*: Separates "Gesture Strokes" (circle, underline, arrow, grid lines) |
|  from "Content Strokes" so gesture lines never corrupt Stage 2 text OCR!             |
+======================================================================================+
                                          │
                                          ▼
+======================================================================================+
| STAGE 2: ON-DEVICE NEURAL INK & VISION WORKER (WebGPU / WASM, 80ms - 650ms)          |
|  • Renders "Content Strokes" to a normalized 2x OffscreenCanvas (high-contrast ink)  |
|  • Line & Sigil HTR (`TrOCR-handwritten` / `PP-OCRv4` ONNX):                         |
|    Transcribes words + inline sigils (#tag, @date, ?question, !axiom, 1. item)       |
|  • Structural & Math Specialist (`Florence-2-base-ft` q4f16 / `UniMERNet` ONNX):     |
|    Triggered when Stage 1 or HTR detects `$` math, complex tables, or standalone     |
|    margin sigils (?, !, #, @) that need 2D spatial context.                          |
+======================================================================================+
                                          │
                                          ▼
+======================================================================================+
| STAGE 3: SEMANTIC INDEXER & BACKGROUND ACTION DISPATCHER                             |
|  • Validates output with Zod (`SemanticRecognitionResultSchema`)                     |
|  • Indexes keywords, salience weights, #tags, and @entities in SQLite                |
|  • Writes directed edges to `spatial_relations` & `zettel_links`                     |
|  • Upserts `[ ]` and `@date` items into `agenda_tasks`                               |
|  • Enqueues background AI jobs (`verify_claim`, `compile_latex`, `synthesize_zettel`)|
+======================================================================================+
```

### Why "Stroke Masking" Between Stage 1 and Stage 2 Is the Secret to High Accuracy
In standard OCR apps, if a user writes `"mitochondria"` and then **circles** or **underlines** it, the circle/underline pixels cut through the ascenders and descenders (`t`, `d`, `p`, `g`), causing OCR accuracy to plummet by 25–40%.
Because NoteFlow stores every stroke as an independent `vector_stroke` row in SQLite with its own `created_at` timestamp and `Float32Array` points:
1. Stage 1 identifies that Stroke #19 is an `enclosure_loop` or `emphasis_underline` modifying Strokes #12–#18.
2. When rendering the offscreen bitmap for Stage 2 Neural OCR, **NoteFlow renders only Strokes #12–#18 (excluding Stroke #19)**.
3. Stage 2 OCR sees clean, unoccluded handwriting (`"mitochondria"`), while Stage 3 still knows the word was circled or underlined!

---

## 4. Complete Recognition, Indexing & Action Specification (All 11 Interactions)

### 4.1 Spatial Gestures & Structural Diagrams

#### 1. Circle a Word / Phrase (`enclosure_loop`)
*   **Stage 1 Vector Detection:**
    *   Cumulative signed turning angle $|\sum_{i} \Delta\theta_i| \ge 1.75\pi$ (`315°+`) and start-to-end Euclidean distance $d(\text{start}, \text{end}) < 0.25 \times \text{perimeter}$.
    *   R-Tree query confirms the loop's polygon encloses $\ge 1$ existing `vector_stroke` with `created_at < loop.created_at` (using `isPointInPolygon`). This guarantees a newly written letter `'O'` or `'0'` (which encloses no prior strokes) is **never** misclassified as a circle gesture.
*   **Stage 2 Neural OCR:**
    *   Crops and transcribes only the enclosed strokes (with the enclosing loop stroke masked out).
*   **Keyword Indexing & Triggered Action:**
    *   **Keyword Index:** Extracts the enclosed word/phrase into `semantic_tags_json` with boosted salience (`role: 'circled_concept'`, `weight: 2.0`).
    *   **Idea Interaction / Action:** Queries `ZettelRepository.searchByCosineSimilarity()` and keyword index in the background. If a matching Zettel (`similarity > 0.80`) exists, surfaces a subtle Ghost Link tether; also attaches a non-intrusive concept badge allowing 1-tap Zettel synthesis or Socratic definition.

#### 2. Underline (`emphasis_underline` & `double_underline`)
*   **Stage 1 Vector Detection:**
    *   Aspect ratio $\text{width} / \max(1, \text{height}) \ge 4.0$, straightness ratio $\text{chordLength} / \text{arcLength} \ge 0.90$, and slope $|\Delta y / \Delta x| < 0.18$.
    *   R-Tree query finds a text cluster whose bottom baseline (`max_y`) sits `2px–36px` above the stroke's Y-coordinate with $\ge 45\%$ horizontal X-span overlap.
    *   If a second parallel underline stroke is drawn within `14px` vertically, upgrades classification to `double_underline`.
*   **Stage 2 Neural OCR:**
    *   Crops the horizontal slice `[underline.min_x, underline.max_x]` of the cluster above it (masking out the underline stroke) to extract the exact underlined word(s).
*   **Keyword Indexing & Triggered Action:**
    *   **Single Underline:** Indexes the extracted span as `emphasized_keyword` (`weight: 1.5`) in SQLite and highlights the keyword in the canvas search index.
    *   **Double Underline:** Promotes the text to `section_header` / `core_definition` (`weight: 2.5`), using it as the default title when synthesizing a Zettel card from the surrounding cluster.

#### 3. Pointing Arrow Between 2 Chunks of Text (`directed_connector`)
*   **Stage 1 Vector Detection:**
    *   Supports both **1-stroke arrows** (a shaft curve with a sharp terminal reflex angle $> 120^\circ$ near the end) and **2/3-stroke arrows** (an elongated shaft stroke `L > 40px` paired with a 1-or-2 stroke V-shaped arrowhead whose vertex lies within `28px` of either shaft endpoint).
    *   Determines direction vector $\vec{v}_{\text{tip}}$ from the arrowhead orientation:
        *   **Source Anchor (`tail`):** Queries R-Tree within a `64px` radius of `shaft.start` (opposite the arrowhead) to bind `source_node_id`.
        *   **Target Anchor (`head`):** Ray-casts from `shaft.end` along $\vec{v}_{\text{tip}}$ (up to `96px`) in the R-Tree to bind `target_node_id`.
*   **Stage 2 Neural OCR:**
    *   Checks if a small unattached text cluster sits within `32px` of the arrow shaft's midpoint (e.g., handwritten edge label like `"causes"`, `"contradicts"`, `"implies"`, `"vs"`). If present, transcribes `label_text`.
*   **Idea Interaction Indexing & Triggered Action:**
    *   **Graph Indexing:** Inserts a row into `spatial_relations` (`source_node_id`, `target_node_id`, `arrow_stroke_id`, `relation_kind`, `label_text`).
    *   **Semantic Relation Mapping:** Maps `label_text` (or defaults to `'leads_to'`) into `zettel_links` (`supports`, `contradicts`, `derives_from`, `related`) whenever either cluster is synthesized into a Zettel card.
    *   **Dynamic Tether:** When `source_node_id` or `target_node_id` is moved via `MoveNodesCommand`, the relational link remains intact.

#### 4. Comparison Table (`comparison_table`)
*   **Stage 1 Vector Detection:**
    *   Detects **Explicit Grids** ($N \ge 1$ long horizontal divider strokes intersecting $M \ge 1$ long vertical divider strokes) **and Implicit Borderless Tables** (2D X/Y bounding-box projection histograms showing $\ge 2$ aligned column gutters across $\ge 2$ horizontal rows).
    *   Computes cell bounding boxes `Cell[row][col]` and assigns child `vector_stroke`s to their containing `(row, col)` cell via R-Tree containment.
*   **Stage 2 Neural OCR & Vision:**
    *   Runs HTR per cell `Cell[r][c]` (with grid divider lines masked out) and optionally runs `Florence-2-base-ft` on the full table crop to validate merged headers.
*   **Idea Interaction Indexing & Triggered Action:**
    *   **Indexing:** Stores structured JSON `{ headers: string[], rows: string[][], cellNodeIds: NodeId[][] }` in the parent cluster's `content_json` and creates `'compares_with'` relations between the column header keywords (`Header A <-> Header B`).
    *   **Action:** Spawns a subtle `📊 Table` badge on the top-right corner of the table; tapping it synthesizes a clean **Markdown / KaTeX Comparison Card** beside the handwritten table or checks factual comparisons in the background.

#### 5. Numbering (`1.`, `2.`, `a)`, `(i)`)
*   **Stage 1 + Stage 2 Detection:**
    *   Stage 1 identifies vertically stacked line clusters sharing a common left margin (`|min_x_i - min_x_j| < 36px`).
    *   Stage 2 OCR transcribes the line and applies the ordinal prefix parser: `/^\s*(?:(\d+)[\.\)]|([a-zA-Z])[\.\)]|\(([ivxlcdm]+|\d+)\))\s+(.*)$/i`.
*   **Keyword Indexing & Triggered Action:**
    *   **Indexing:** Records `ordered_list_item` metadata (`listId`, `ordinalIndex`, `markerText`) on each line cluster and links consecutive items (`step_i -> step_{i+1}`) in `spatial_relations`.
    *   **Action:** When synthesizing a Zettel or exporting notes, preserves the exact numbered hierarchy as a structured Markdown ordered list.

#### 6. Brackets (`[ ]`, `{ }`, `( )`)
*   **Square Brackets `[ ]` / `[x]` (Actionable Tasks):**
    *   *Detection:* Stage 1 detects a 1-to-4 stroke small closed/open box (`12px–42px` square) at the left start of a line cluster, OR Stage 2 OCR transcribes a leading `[ ]`, `[]`, `[x]`, or `✓`.
    *   *Indexing & Action:* Inserts/updates a row in `agenda_tasks` (`status: 'open' | 'completed'`, `task_text`). If the user later draws a checkmark (`✓`) or cross (`x`) whose bbox intersects an existing open `[ ]` box, Stage 1 detects the intersection and automatically transitions the task to `status = 'completed'`!
*   **Curly Braces `{ }` (Multi-Line Scope Grouping):**
    *   *Detection:* Stage 1 detects a tall vertical stroke (`height > 60px`, `height / width > 2.2`) with a central inflection cusp pointing toward an adjacent stack of $K \ge 2$ text clusters.
    *   *Indexing & Action:* Creates a `part_of` / `grouped_by` relation in `spatial_relations` binding all $K$ spanned clusters to the summary cluster located on the cusp side of the `{` or `}` brace.
*   **Parentheses `( )` (Inline Citations & Asides):**
    *   *Detection:* Stage 2 OCR regex `/\(([^()]{2,80})\)/g`.
    *   *Indexing & Action:* Extracts parenthetical expressions (e.g., `(Shannon, 1948)`, `(see Fig. 2)`) as `citation_or_aside` metadata in `content_json` and cross-links matching PDF sources in the Split-Screen Reader.

---

### 4.2 Semantic Sigils (`#`, `?`, `!`, `@`, `$`)

All 5 sigils are recognized whether written **inline inside a phrase** (via Stage 2 `TrOCR` / `PP-OCRv4` + `Florence-2`) or **drawn standalone in the margin** next to a cluster (via Stage 1 + Stage 2 cropped symbol classification):

| Sigil | Handwritten Pattern Examples | Stage 1 + Stage 2 Recognition Rule | SQLite Indexing Effect | Background Action Triggered |
| :---: | :--- | :--- | :--- | :--- |
| **`#`** | `#mitosis`, `#exam-1`, `#todo` | Stage 2 OCR regex `/(?:^|\s)#([a-zA-Z0-9_/-]+)/g` + standalone `#` cross-hatch topology detector (`2` horizontal $\times$ `2` vertical bars). | Normalizes tag to lowercase (`#mitosis`) and appends to `spatial_nodes.semantic_tags_json`. | Automatically links clusters sharing the same `#tag` across the canvas and Zettel Vault. |
| **`?`** | Standalone `?` in margin, circled `?`, or claim ending in `?` | Stage 2 OCR trailing/isolated `?` + Stage 1 hook-above-dot vertical topology detector within `48px` of a cluster. | Marks cluster with `intent: 'socratic_inquiry'` in `content_json`. | **Enqueues `verify_claim` / `socratic_hint` job** in `AsyncJobQueue` (`◌ → ↻ → ●` badge) to verify the claim or generate a Socratic hint on Layer 2 (`hints_work`). |
| **`!`** | Standalone `!`, `!!`, or `[!]` in left/right margin of a paragraph | Stage 2 OCR `!` + Stage 1 vertical-stem-above-dot topology detector adjacent to a cluster. | Marks cluster with `priority: 'critical_axiom'` (`salience: 3.0`) in `content_json` and `agenda_tasks`. | Boosts retrieval rank in Zettel Vault and queues a `synthesize_zettel` draft so key insights are never lost. |
| **`@`** | `@tomorrow`, `@2026-11-15`, `@ProfSmith` | Stage 2 OCR regex `/(?:^|\s)@([a-zA-Z0-9_/-]+)/g` + natural-language date parser (`today`, `tomorrow`, `monday`, `YYYY-MM-DD`). | If temporal (`@date`), sets `due_date_iso` on `agenda_tasks`. If person/concept (`@entity`), indexes `mention:@entity` in `semantic_tags_json`. | Surfaces the cluster in the **Agenda Drawer** sorted by deadline or links to the referenced `@entity` Zettel card. |
| **`$`** | `$ \int_0^\infty e^{-x} dx $`, or leading `$` next to an equation | Stage 2 OCR `$` token or `Florence-2` / math-density classifier detecting mathematical notation (`\sum`, `\int`, fractions, subscripts). | Tags cluster as `math_expression` and stores recognized LaTeX string in `content_json.latex`. | **Enqueues `compile_latex` job** in `AsyncJobQueue`, allowing 1-tap execution of `CompileMathBlockCommand` onto Layer 4 (`math_formal`). |

---

## 5. Pluggable Port & SQLite Schema Design (Built for Easy Future Swapping)

### 5.1 Pluggable `InkRecognitionPort` (`src/ai/ink_recognition/recognition_port.ts`)
To ensure we can switch from **Option 1 (`OnnxWebGpuHybridRecognizer`)** to **Option 2 (`MlKitStrokeRecognizer`)**, **Option 3 (`SmolVlmRecognizer`)**, or **Option 4 (`DeterministicHeuristicRecognizer`)** via a 1-line configuration flag (or automatic runtime fallback if WebGPU fails to initialize), all recognizers implement a single strict contract validated by Zod:

```typescript
// src/ai/ink_recognition/recognition_port.ts
import { z } from 'zod';

export const DetectedGestureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('enclosure_loop'),
    loopStrokeId: z.string(),
    enclosedStrokeIds: z.array(z.string()),
    enclosedText: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('underline'),
    underlineStrokeIds: z.array(z.string()),
    targetClusterId: z.string(),
    underlinedText: z.string(),
    isDouble: z.boolean(),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('pointing_arrow'),
    arrowStrokeIds: z.array(z.string()),
    sourceNodeId: z.string(),
    targetNodeId: z.string(),
    labelText: z.string().nullable(),
    relationKind: z.enum(['leads_to', 'derives_from', 'supports', 'contradicts']),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('comparison_table'),
    gridStrokeIds: z.array(z.string()),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('curly_brace_group'),
    braceStrokeId: z.string(),
    spannedClusterIds: z.array(z.string()),
    summaryClusterId: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  }),
]);

export const ExtractedSigilsSchema = z.object({
  ocrTranscript: z.string(),
  hashtags: z.array(z.string()),                 // #tag
  mentionsAndDates: z.array(z.object({           // @date / @entity
    raw: z.string(),
    kind: z.enum(['date', 'entity']),
    isoDate: z.string().nullable(),
  })),
  hasQuestionTrigger: z.boolean(),               // ?
  hasImportantAxiomTrigger: z.boolean(),         // !
  latexBlocks: z.array(z.string()),              // $...$
  checkboxState: z.enum(['none', 'open', 'completed']), // [ ] or [x]
  orderedListMarker: z.object({                  // 1., 2., a), (i)
    ordinalIndex: z.number().int(),
    rawMarker: z.string(),
  }).nullable(),
  parentheticalCitations: z.array(z.string()),   // (...)
});

export interface InkRecognitionPort {
  readonly backendId: 'onnx-webgpu-hybrid' | 'mlkit-stroke-wasm' | 'edge-vlm-webgpu' | 'heuristic-test';
  analyzeClusterAndNeighborhood(input: {
    canvasId: string;
    layerId: string;
    targetClusterId: string;
  }): Promise<{
    gestures: z.infer<typeof DetectedGestureSchema>[];
    sigils: z.infer<typeof ExtractedSigilsSchema>;
  }>;
}
```

### 5.2 SQLite Schema Additions (`src/db/schema.sql`)
To persist relational idea interactions and extracted tasks/keywords, two tables will be added to `src/db/schema.sql`:

```sql
-- 6. Spatial Relations & Arrow Connectors (Idea Interaction Graph)
CREATE TABLE IF NOT EXISTS spatial_relations (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    arrow_stroke_id TEXT REFERENCES spatial_nodes(id) ON DELETE SET NULL,
    relation_kind TEXT NOT NULL CHECK(relation_kind IN (
        'leads_to', 'derives_from', 'supports', 'contradicts', 'compares_with', 'part_of'
    )),
    label_text TEXT,
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(source_node_id, target_node_id, relation_kind)
);

-- 7. Agenda Tasks & Extracted [ ] / @date / ! Items
CREATE TABLE IF NOT EXISTS agenda_tasks (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    cluster_node_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    task_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'completed', 'cancelled')),
    due_date_iso TEXT,
    priority INTEGER NOT NULL DEFAULT 0, -- 0 = normal, 1 = '!' critical axiom/priority
    tags_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

---

## 6. How to Benchmark & Swap Options If Option 1 Underperforms

If during real-tablet dogfooding we find that a specific user's cursive style or tablet GPU causes Option 1 (`TrOCR` / `PP-OCRv4` + `Florence-2`) to miss certain symbols:
1. **Golden Ink Corpus (`tests/fixtures/golden_ink_corpus.json`):** Every time a false positive or false negative occurs on tablet, we export the raw `Float32Array` stroke sequence into `golden_ink_corpus.json` with expected ground-truth labels.
2. **Swap to Option 2 (Stroke-Sequence Transformer) for Inline Symbols:** If raster crop OCR struggles with rapid multi-stroke symbols (`#`, `$`, `@`) written with overlapping strokes, enable `MlKitStrokeRecognizer` for single-cluster transcription—because stroke-sequence transformers see the exact temporal pen-down/pen-up sequence `(x, y, t)` rather than flattened pixels.
3. **Swap to Option 3 (`SmolVLM-256M` / `Gemini Nano`) for Complex Tables & Diagrams:** If a comparison table has curved/missing divider lines that defeat Stage 1 projection profiles, route `comparison_table` candidates to `EdgeVlmRecognizer` with a structured JSON schema prompt.
