-- 1. Canvases & Smart Layers
CREATE TABLE IF NOT EXISTS canvases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    camera_state_json TEXT NOT NULL, -- { panX, panY, zoom, rotation }
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS layers (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    layer_type TEXT NOT NULL CHECK(layer_type IN ('notes', 'hints_work', 'ai_feedback', 'math_formal')),
    z_index INTEGER NOT NULL,
    is_visible INTEGER NOT NULL DEFAULT 1,
    is_locked INTEGER NOT NULL DEFAULT 0,
    opacity REAL NOT NULL DEFAULT 1.0
);

-- 2. Spatial Nodes (Single source of truth for all canvas items)
CREATE TABLE IF NOT EXISTS spatial_nodes (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL CHECK(node_type IN (
        'vector_stroke', 'stroke_cluster', 'zettel_card', 'math_block', 'media_item', 'portal'
    )),
    parent_cluster_id TEXT REFERENCES spatial_nodes(id) ON DELETE SET NULL,
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

-- Automatic Triggers to guarantee R-Tree never drifts from spatial_nodes
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
    job_type TEXT NOT NULL CHECK(job_type IN ('cluster_ocr', 'verify_claim', 'compile_latex', 'synthesize_zettel')),
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
    result_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 5. Zettelkasten Knowledge Graph
CREATE TABLE IF NOT EXISTS zettels (
    id TEXT PRIMARY KEY,
    spatial_node_id TEXT UNIQUE REFERENCES spatial_nodes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary_markdown TEXT NOT NULL,
    latex_blocks_json TEXT,
    verification_state TEXT NOT NULL CHECK(verification_state IN ('unverified', 'verified', 'conflict', 'hint')),
    embedding F32_BLOB(768),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS zettel_links (
    id TEXT PRIMARY KEY,
    source_zettel_id TEXT NOT NULL REFERENCES zettels(id) ON DELETE CASCADE,
    target_zettel_id TEXT NOT NULL REFERENCES zettels(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('supports', 'contradicts', 'derives_from', 'related')),
    confidence REAL NOT NULL DEFAULT 1.0,
    UNIQUE(source_zettel_id, target_zettel_id, relation_type)
);
