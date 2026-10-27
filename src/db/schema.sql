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
    spatial_node_id TEXT REFERENCES spatial_nodes(id) ON DELETE SET NULL,
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

-- 6. Multimodal Canvas Blocks (100% Registration of Prose, Sketches, Tables, Math, Lists)
CREATE TABLE IF NOT EXISTS canvas_blocks (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    spatial_node_id TEXT NOT NULL UNIQUE REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    modality TEXT NOT NULL CHECK(modality IN (
        'prose_explanation',
        'sketch_diagram',
        'comparison_table',
        'math_expression',
        'ordered_list'
    )),
    raw_text TEXT NOT NULL DEFAULT '',
    structured_json TEXT,
    min_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_x REAL NOT NULL,
    max_y REAL NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 7. Symbol-Marked Keywords (Selective Promotion to Atomic Zettels)
CREATE TABLE IF NOT EXISTS zettel_keywords (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    zettel_id TEXT NOT NULL REFERENCES zettels(id) ON DELETE CASCADE,
    source_block_id TEXT NOT NULL REFERENCES canvas_blocks(id) ON DELETE CASCADE,
    keyword_text TEXT NOT NULL,
    normalized_keyword TEXT NOT NULL,
    marker_type TEXT NOT NULL CHECK(marker_type IN (
        'circle',
        'underline',
        'double_underline',
        'hash_tag',
        'bang_axiom',
        'question_inquiry',
        'at_entity'
    )),
    is_primary_concept INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- 8. Multimodal Supporting Evidence Links (Prose, Sketches, Tables -> Atomic Zettels)
CREATE TABLE IF NOT EXISTS zettel_evidence_links (
    id TEXT PRIMARY KEY,
    zettel_id TEXT NOT NULL REFERENCES zettels(id) ON DELETE CASCADE,
    block_id TEXT NOT NULL REFERENCES canvas_blocks(id) ON DELETE CASCADE,
    evidence_role TEXT NOT NULL CHECK(evidence_role IN (
        'inline_context',
        'pointing_arrow_support',
        'curly_brace_elaboration',
        'enclosed_group',
        'section_flow'
    )),
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at INTEGER NOT NULL,
    UNIQUE(zettel_id, block_id)
);

-- 9. Spatial Relations (Pointing Arrows & Curly Braces)
CREATE TABLE IF NOT EXISTS spatial_relations (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    connector_stroke_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('pointing_arrow', 'curly_brace_group')),
    created_at INTEGER NOT NULL
);

-- 10. Agenda Tasks ([ ] / [x] / @date Hooks)
CREATE TABLE IF NOT EXISTS agenda_tasks (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES spatial_nodes(id) ON DELETE CASCADE,
    task_text TEXT NOT NULL,
    due_date_iso TEXT,
    status TEXT NOT NULL CHECK(status IN ('todo', 'done')),
    created_at INTEGER NOT NULL
);
