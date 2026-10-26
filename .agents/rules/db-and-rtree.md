---
trigger: glob
globs: "src/db/**, **/*.sql"
description: "SQLite, R-Tree, and sqlite-vec invariants for NoteFlow local persistence."
---

# Database & Spatial Index Invariants

1. **SQLite R-Tree Integer Key Rule:**
   - `spatial_nodes_rtree` is an SQLite virtual R-Tree table and strictly requires a 64-bit signed `INTEGER` primary key (`id`).
   - `spatial_nodes.id` is a `TEXT` UUID, so `spatial_nodes_rtree.id` maps to `spatial_nodes.rowid`.
   - **NEVER** manually `INSERT`, `UPDATE`, or `DELETE` on `spatial_nodes_rtree` in TypeScript code—let the SQLite triggers (`sync_rtree_insert`, `sync_rtree_update`, `sync_rtree_delete`) maintain it automatically.
   - When querying the R-Tree, always join via `INNER JOIN spatial_nodes_rtree r ON spatial_nodes.rowid = r.id`.

2. **Dynamic Badge Coordinates:**
   - `async_jobs` does NOT store `x, y` coordinates. Always derive badge coordinates dynamically via `anchor_node_id` joining `spatial_nodes.max_x` and `spatial_nodes.min_y`.

3. **Tier 0 Clustering Before OCR:**
   - Raw single strokes (`node_type = 'vector_stroke'`) are grouped into a parent `stroke_cluster` (`parent_group_id`). OCR transcripts (`ocr_transcript`) belong on the `stroke_cluster`.
