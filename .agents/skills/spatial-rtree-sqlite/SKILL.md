---
name: spatial-rtree-sqlite
description: Architectural runbook for SQLite WASM, Web Worker OPFS concurrency, R-Tree spatial indexing, automatic SQL triggers, and sqlite-vec vector search in NoteFlow. Use whenever modifying database schema, repositories, Worker bridges, spatial queries, or vector similarity.
---

# NoteFlow Spatial SQLite, R-Tree & Worker Bridge Runbook

This skill outlines the non-negotiable patterns for SQLite persistence, 2D R-Tree spatial indexing, Web Worker OPFS concurrency, and vector similarity in NoteFlow.

## 1. The 64-bit Integer R-Tree Invariant

SQLite's virtual R-Tree table module (`rtree`) requires a signed 64-bit `INTEGER` primary key. NoteFlow entities use UUID `TEXT` identifiers (`NodeId`, `CanvasId`, `LayerId`).

### The Rule
- `spatial_nodes.id` is a UUID `TEXT` primary key.
- `spatial_nodes_rtree.id` is an `INTEGER` primary key that maps directly to `spatial_nodes.rowid`.
- **Never insert, update, or delete `spatial_nodes_rtree` directly in TypeScript code, and never expose `rowid` outside SQL queries.**
- Let SQLite triggers maintain the R-Tree index automatically:

```sql
-- Virtual R-Tree table
CREATE VIRTUAL TABLE spatial_nodes_rtree USING rtree(
    id,             -- Maps to spatial_nodes.rowid
    min_x, max_x,   -- 2D Axis-Aligned Bounding Box (AABB)
    min_y, max_y
);

-- Triggers for automatic synchronization
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
```

## 2. Spatial Query Patterns

### Viewport Culling & Lasso Bounding Box
To query nodes intersecting a 2D world bounding box `[queryMinX, queryMinY, queryMaxX, queryMaxY]`:

```sql
SELECT n.*
FROM spatial_nodes n
INNER JOIN spatial_nodes_rtree r ON n.rowid = r.id
WHERE n.canvas_id = :canvasId
  AND r.min_x <= :queryMaxX
  AND r.max_x >= :queryMinX
  AND r.min_y <= :queryMaxY
  AND r.max_y >= :queryMinY;
```

## 3. Dynamic Badge Coordinates (Zero Redundancy)

`async_jobs` records do **not** store coordinate fields `(x, y)`:
- Badge coordinates are dynamically derived via JOIN:
  - Anchor `x = spatial_nodes.max_x`
  - Anchor `y = spatial_nodes.min_y`
- When a `CanvasCommand` translates a spatial node, the anchor node updates, the SQLite trigger updates the R-Tree, and the badge automatically moves with zero desync.

```sql
SELECT 
    j.*, 
    n.max_x AS anchor_x, 
    n.min_y AS anchor_y
FROM async_jobs j
INNER JOIN spatial_nodes n ON j.anchor_node_id = n.id
WHERE j.canvas_id = :canvasId;
```

## 4. Vector Similarity Search (`sqlite-vec`)

Zettel embeddings use 384 dimensions (`all-MiniLM-L6-v2`):

```sql
CREATE VIRTUAL TABLE zettel_embeddings USING vec0(
    zettel_id TEXT PRIMARY KEY,
    embedding FLOAT[384]
);

-- Cosine Distance KNN Query (top K closest zettels):
SELECT 
    z.id, 
    z.title, 
    z.atomic_statement, 
    e.distance
FROM zettel_embeddings e
INNER JOIN zettels z ON z.id = e.zettel_id
WHERE e.embedding MATCH :queryEmbeddingVector
  AND k = 5;
```

## 5. Web Worker OPFS Bridge & Main-Thread Hot Spatial Cache

SQLite WASM with OPFS persistence (`opfs-sahpool` VFS) runs inside a dedicated Web Worker (`docs/SPEC.md` §3 Bottom Layer).

### Concurrency Invariants
1. **Never `await` Worker RPC Inside 120Hz Render or Synchronous Pointer Loops:**
   - The Unified Scene Graph (`src/ui/scene_graph/`) renders from an optimistic in-memory scene graph mirror (`canvas_store.ts`).
   - When `PEN_UP` commits a stroke, the main thread optimistically adds the node to the scene graph mirror and dispatches the `CanvasCommand` to the SQLite Worker in the background.
2. **Zero-Copy `Transferable` Payloads:**
   - When sending `Float32Array` stroke buffers (`StrokeCommittedEvent.points`) to the DB Worker, either transfer ownership via `worker.postMessage(msg, [points.buffer])` (if the main thread no longer mutates that buffer) or send a dedicated slice so GC pressure stays zero.
3. **Cross-Origin Isolation Headers (Required for OPFS / SharedArrayBuffer):**
   - Any Vite/dev server configuration must set:
     ```ts
     headers: {
       'Cross-Origin-Opener-Policy': 'same-origin',
       'Cross-Origin-Embedder-Policy': 'require-corp',
     }
     ```

## 6. Atomic Command Transactions & In-Flight AI Job Cancellation

1. **Single SQLite Transaction per `CanvasCommand`:**
   - Multi-row mutations (such as `MoveNodesCommand` translating a `stroke_cluster` and its child `vector_stroke` nodes) MUST run inside an explicit `BEGIN IMMEDIATE ... COMMIT` transaction (with `ROLLBACK` on error) so R-Tree triggers update atomically.
2. **In-Flight AI Job Cancellation on Undo:**
   - If a user triggers an `async_job` (`◌ Queued` or `🔄 Running`) anchored to a `spatial_node` and then executes `undo()` on the command that created or grouped that node:
     - The command `undo()` or job scheduler MUST abort the in-flight job via `AbortController` and mark/delete the `async_jobs` record.
     - Worker tool completions (`UpdateJobBadgeToolSchema`) must check that `anchor_node_id` still exists before applying results, preventing "zombie badges" on undone strokes.

## 7. Headless Verification Pattern

Always verify database operations in headless tests using an in-memory SQLite database (`:memory:`):
1. Execute `schema.sql`.
2. Insert a `spatial_node`.
3. Assert that `SELECT COUNT(*) FROM spatial_nodes_rtree` returns `1`.
4. Update node coordinates (`UPDATE spatial_nodes SET min_x = ...`) inside a transaction.
5. Query the R-Tree via `INNER JOIN spatial_nodes_rtree r ON n.rowid = r.id` to verify updated bounds.
6. Delete the node and verify that `spatial_nodes_rtree` and cascading `async_jobs` are empty.
