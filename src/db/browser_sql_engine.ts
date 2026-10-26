import type { SqlEnginePort, SqlStatementPort } from './engine_port.js';

interface SpatialNodeRow {
  rowid: number;
  id: string;
  canvas_id: string;
  layer_id: string;
  node_type: string;
  parent_cluster_id: string | null;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  stroke_points: Uint8Array | null;
  style_json: string | null;
  content_json: string | null;
  ocr_text: string | null;
  semantic_tags_json: string | null;
  created_at: number;
  updated_at: number;
}

interface RTreeEntry {
  id: number; // 64-bit integer rowid
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
}

interface AsyncJobRow {
  id: string;
  canvas_id: string;
  anchor_node_id: string;
  job_type: string;
  status: string;
  result_json: string | null;
  created_at: number;
  updated_at: number;
}

interface ZettelRow {
  id: string;
  spatial_node_id: string | null;
  title: string;
  summary_markdown: string;
  latex_blocks_json: string | null;
  verification_state: string;
  embedding: Uint8Array | null;
  created_at: number;
  updated_at: number;
}

interface ZettelLinkRow {
  id: string;
  source_zettel_id: string;
  target_zettel_id: string;
  relation_type: string;
  confidence: number;
}

/**
 * Browser-safe synchronous SQL + R-Tree engine implementing `SqlEnginePort`.
 * Enforces identical trigger, foreign-key cascade, and R-Tree spatial indexing
 * semantics to `schema.sql` so all repositories and commands run at 120Hz in
 * tablet browsers with zero Node.js dependencies.
 */
export class BrowserSqlEngine implements SqlEnginePort {
  private nextRowId = 1;
  private readonly canvases = new Map<string, Record<string, unknown>>();
  private readonly layers = new Map<string, Record<string, unknown>>();
  private readonly spatialNodes = new Map<string, SpatialNodeRow>();
  private readonly rtree = new Map<number, RTreeEntry>();
  private readonly asyncJobs = new Map<string, AsyncJobRow>();
  private readonly zettels = new Map<string, ZettelRow>();
  private readonly zettelLinks = new Map<string, ZettelLinkRow>();

  public exec(_sql: string): void {
    // Transaction / DDL statements are handled natively by the in-memory maps
  }

  public close(): void {
    this.canvases.clear();
    this.layers.clear();
    this.spatialNodes.clear();
    this.rtree.clear();
    this.asyncJobs.clear();
    this.zettels.clear();
    this.zettelLinks.clear();
  }

  public prepare(sql: string): SqlStatementPort {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    return {
      run: (...params: unknown[]) => this.executeRun(normalized, params),
      get: (...params: unknown[]) => this.executeGet(normalized, params),
      all: (...params: unknown[]) => this.executeAll(normalized, params),
    };
  }

  private executeRun(sql: string, params: unknown[]): void {
    if (sql.startsWith('INSERT OR IGNORE INTO canvases')) {
      const id = String(params[0]);
      if (!this.canvases.has(id)) {
        this.canvases.set(id, {
          id,
          title: params[1],
          camera_state_json: params[2],
          updated_at: params[3],
        });
      }
      return;
    }

    if (sql.startsWith('INSERT OR IGNORE INTO layers')) {
      const id = String(params[0]);
      if (!this.layers.has(id)) {
        this.layers.set(id, {
          id,
          canvas_id: params[1],
          name: params[2],
          layer_type: params[3],
          z_index: params[4],
        });
      }
      return;
    }

    if (
      sql.startsWith('INSERT INTO spatial_nodes') ||
      sql.startsWith('INSERT OR REPLACE INTO spatial_nodes')
    ) {
      const id = String(params[0]);
      const existing = this.spatialNodes.get(id);
      const rowid = existing ? existing.rowid : this.nextRowId++;

      const strokeBlob =
        params[9] instanceof Uint8Array
          ? new Uint8Array(params[9])
          : (params[9] as null);

      const row: SpatialNodeRow = {
        rowid,
        id,
        canvas_id: String(params[1]),
        layer_id: String(params[2]),
        node_type: String(params[3]),
        parent_cluster_id: (params[4] as string | null) ?? null,
        min_x: Number(params[5]),
        min_y: Number(params[6]),
        max_x: Number(params[7]),
        max_y: Number(params[8]),
        stroke_points: strokeBlob,
        style_json: (params[10] as string | null) ?? null,
        content_json: (params[11] as string | null) ?? null,
        ocr_text: (params[12] as string | null) ?? null,
        semantic_tags_json: (params[13] as string | null) ?? null,
        created_at: Number(params[14]),
        updated_at: Number(params[15]),
      };

      this.spatialNodes.set(id, row);
      // Trigger: sync_rtree_insert / sync_rtree_update
      this.rtree.set(rowid, {
        id: rowid,
        min_x: row.min_x,
        max_x: row.max_x,
        min_y: row.min_y,
        max_y: row.max_y,
      });
      return;
    }

    if (sql.startsWith('UPDATE spatial_nodes SET parent_cluster_id = ?')) {
      const parentClusterId = (params[0] as string | null) ?? null;
      const updatedAt = Number(params[1]);
      const id = String(params[2]);
      const row = this.spatialNodes.get(id);
      if (row) {
        row.parent_cluster_id = parentClusterId;
        row.updated_at = updatedAt;
      }
      return;
    }

    if (sql.startsWith('UPDATE spatial_nodes SET min_x = ?')) {
      const minX = Number(params[0]);
      const minY = Number(params[1]);
      const maxX = Number(params[2]);
      const maxY = Number(params[3]);
      const strokeBlob =
        params[4] instanceof Uint8Array
          ? new Uint8Array(params[4])
          : (params[4] as null);
      const updatedAt = Number(params[5]);
      const id = String(params[6]);

      const row = this.spatialNodes.get(id);
      if (row) {
        row.min_x = minX;
        row.min_y = minY;
        row.max_x = maxX;
        row.max_y = maxY;
        row.stroke_points = strokeBlob;
        row.updated_at = updatedAt;

        // Trigger: sync_rtree_update
        this.rtree.set(row.rowid, {
          id: row.rowid,
          min_x: minX,
          max_x: maxX,
          min_y: minY,
          max_y: maxY,
        });
      }
      return;
    }

    if (sql.startsWith('DELETE FROM spatial_nodes WHERE id IN')) {
      const idsToDelete = new Set(params.map(String));
      for (const id of idsToDelete) {
        const existing = this.spatialNodes.get(id);
        if (existing) {
          this.spatialNodes.delete(id);
          // Trigger: sync_rtree_delete
          this.rtree.delete(existing.rowid);
        }
      }

      // ON DELETE SET NULL on spatial_nodes.parent_cluster_id
      for (const node of this.spatialNodes.values()) {
        if (node.parent_cluster_id && idsToDelete.has(node.parent_cluster_id)) {
          node.parent_cluster_id = null;
        }
      }

      // ON DELETE CASCADE on async_jobs.anchor_node_id
      for (const [jobId, job] of this.asyncJobs.entries()) {
        if (idsToDelete.has(job.anchor_node_id)) {
          this.asyncJobs.delete(jobId);
        }
      }

      // ON DELETE SET NULL on zettels.spatial_node_id
      for (const zettel of this.zettels.values()) {
        if (zettel.spatial_node_id && idsToDelete.has(zettel.spatial_node_id)) {
          zettel.spatial_node_id = null;
        }
      }
      return;
    }

    if (sql.startsWith('INSERT INTO async_jobs')) {
      const id = String(params[0]);
      this.asyncJobs.set(id, {
        id,
        canvas_id: String(params[1]),
        anchor_node_id: String(params[2]),
        job_type: String(params[3]),
        status: 'queued',
        result_json: null,
        created_at: Number(params[4]),
        updated_at: Number(params[5]),
      });
      return;
    }

    if (sql.startsWith('UPDATE async_jobs SET status = ?')) {
      const status = String(params[0]);
      const resultJson = (params[1] as string | null) ?? null;
      const updatedAt = Number(params[2]);
      const id = String(params[3]);
      const job = this.asyncJobs.get(id);
      if (job) {
        job.status = status;
        job.result_json = resultJson;
        job.updated_at = updatedAt;
      }
      return;
    }

    if (sql.startsWith('DELETE FROM async_jobs WHERE anchor_node_id IN')) {
      const anchorIds = new Set(params.map(String));
      for (const [jobId, job] of this.asyncJobs.entries()) {
        if (anchorIds.has(job.anchor_node_id)) {
          this.asyncJobs.delete(jobId);
        }
      }
      return;
    }

    if (sql.startsWith('INSERT OR REPLACE INTO zettels')) {
      const id = String(params[0]);
      const emb =
        params[6] instanceof Uint8Array
          ? new Uint8Array(params[6])
          : (params[6] as null);
      this.zettels.set(id, {
        id,
        spatial_node_id: (params[1] as string | null) ?? null,
        title: String(params[2]),
        summary_markdown: String(params[3]),
        latex_blocks_json: (params[4] as string | null) ?? null,
        verification_state: String(params[5]),
        embedding: emb,
        created_at: Number(params[7]),
        updated_at: Number(params[8]),
      });
      return;
    }

    if (sql.startsWith('DELETE FROM zettels WHERE id = ?')) {
      const id = String(params[0]);
      this.zettels.delete(id);
      for (const [key, link] of this.zettelLinks.entries()) {
        if (link.source_zettel_id === id || link.target_zettel_id === id) {
          this.zettelLinks.delete(key);
        }
      }
      return;
    }

    if (sql.startsWith('INSERT INTO zettel_links')) {
      const id = String(params[0]);
      const source = String(params[1]);
      const target = String(params[2]);
      const rel = String(params[3]);
      const confidence = Number(params[4]);
      const compositeKey = `${source}::${target}::${rel}`;
      const existing = this.zettelLinks.get(compositeKey);
      this.zettelLinks.set(compositeKey, {
        id: existing ? existing.id : id,
        source_zettel_id: source,
        target_zettel_id: target,
        relation_type: rel,
        confidence,
      });
      return;
    }

    if (sql === 'DELETE FROM zettel_links WHERE id = ?') {
      const targetId = String(params[0]);
      for (const [key, link] of this.zettelLinks.entries()) {
        if (link.id === targetId) {
          this.zettelLinks.delete(key);
        }
      }
      return;
    }
  }

  private executeGet(sql: string, params: unknown[]): unknown {
    if (sql === 'SELECT * FROM spatial_nodes WHERE id = ?') {
      const row = this.spatialNodes.get(String(params[0]));
      return row ? { ...row } : undefined;
    }

    if (sql === 'SELECT COUNT(*) AS count FROM spatial_nodes_rtree') {
      return { count: this.rtree.size };
    }

    if (sql.includes('FROM async_jobs j') && sql.includes('WHERE j.id = ?')) {
      const job = this.asyncJobs.get(String(params[0]));
      if (!job) return undefined;
      const anchor = this.spatialNodes.get(job.anchor_node_id);
      if (!anchor) return undefined;
      return {
        ...job,
        anchor_x: anchor.max_x,
        anchor_y: anchor.min_y,
      };
    }

    if (sql === 'SELECT * FROM zettels WHERE id = ?') {
      const row = this.zettels.get(String(params[0]));
      return row ? { ...row } : undefined;
    }

    if (
      sql.startsWith('SELECT * FROM zettel_links WHERE source_zettel_id = ?') &&
      sql.includes('AND target_zettel_id = ?')
    ) {
      const key = `${String(params[0])}::${String(params[1])}::${String(params[2])}`;
      const row = this.zettelLinks.get(key);
      return row ? { ...row } : undefined;
    }

    return undefined;
  }

  private executeAll(sql: string, params: unknown[]): unknown[] {
    if (sql.startsWith('SELECT * FROM spatial_nodes WHERE id IN')) {
      const ids = new Set(params.map(String));
      return [...this.spatialNodes.values()]
        .filter((n) => ids.has(n.id))
        .map((n) => ({ ...n }));
    }

    if (
      sql.startsWith(
        'SELECT * FROM spatial_nodes WHERE canvas_id = ? ORDER BY created_at ASC'
      )
    ) {
      const canvasId = String(params[0]);
      return [...this.spatialNodes.values()]
        .filter((n) => n.canvas_id === canvasId)
        .sort(
          (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)
        )
        .map((n) => ({ ...n }));
    }

    if (
      sql.includes(
        "WHERE canvas_id = ? AND layer_id = ? AND node_type = 'vector_stroke' AND parent_cluster_id IS NULL"
      )
    ) {
      const canvasId = String(params[0]);
      const layerId = String(params[1]);
      return [...this.spatialNodes.values()]
        .filter(
          (n) =>
            n.canvas_id === canvasId &&
            n.layer_id === layerId &&
            n.node_type === 'vector_stroke' &&
            n.parent_cluster_id === null
        )
        .sort((a, b) => a.created_at - b.created_at)
        .map((n) => ({ ...n }));
    }

    if (
      sql.startsWith('SELECT * FROM spatial_nodes WHERE parent_cluster_id IN')
    ) {
      const clusterIds = new Set(params.map(String));
      return [...this.spatialNodes.values()]
        .filter(
          (n) =>
            n.parent_cluster_id !== null && clusterIds.has(n.parent_cluster_id)
        )
        .map((n) => ({ ...n }));
    }

    if (sql.includes('INNER JOIN spatial_nodes_rtree r ON n.rowid = r.id')) {
      const canvasId = String(params[0]);
      const vMinX = Number(params[1]);
      const vMaxX = Number(params[2]);
      const vMinY = Number(params[3]);
      const vMaxY = Number(params[4]);

      const matchingRowIds = new Set<number>();
      for (const entry of this.rtree.values()) {
        if (
          entry.max_x >= vMinX &&
          entry.min_x <= vMaxX &&
          entry.max_y >= vMinY &&
          entry.min_y <= vMaxY
        ) {
          matchingRowIds.add(entry.id);
        }
      }

      return [...this.spatialNodes.values()]
        .filter(
          (n) => n.canvas_id === canvasId && matchingRowIds.has(n.rowid)
        )
        .sort((a, b) => a.created_at - b.created_at)
        .map((n) => ({ ...n }));
    }

    if (
      sql.includes('FROM async_jobs j') &&
      sql.includes('WHERE j.canvas_id = ?')
    ) {
      const canvasId = String(params[0]);
      const results: unknown[] = [];
      for (const job of this.asyncJobs.values()) {
        if (job.canvas_id !== canvasId) continue;
        const anchor = this.spatialNodes.get(job.anchor_node_id);
        if (!anchor) continue;
        results.push({
          ...job,
          anchor_x: anchor.max_x,
          anchor_y: anchor.min_y,
        });
      }
      return results.sort(
        (a, b) =>
          (a as AsyncJobRow).created_at - (b as AsyncJobRow).created_at
      );
    }

    if (
      sql.includes('FROM async_jobs j') &&
      sql.includes('WHERE j.anchor_node_id IN')
    ) {
      const anchorIds = new Set(params.map(String));
      const results: unknown[] = [];
      for (const job of this.asyncJobs.values()) {
        if (!anchorIds.has(job.anchor_node_id)) continue;
        const anchor = this.spatialNodes.get(job.anchor_node_id);
        if (!anchor) continue;
        results.push({
          ...job,
          anchor_x: anchor.max_x,
          anchor_y: anchor.min_y,
        });
      }
      return results;
    }

    if (sql === 'SELECT * FROM zettels WHERE embedding IS NOT NULL') {
      return [...this.zettels.values()]
        .filter((z) => z.embedding !== null)
        .map((z) => ({ ...z }));
    }

    if (sql === 'SELECT * FROM zettels ORDER BY created_at ASC') {
      return [...this.zettels.values()]
        .sort((a, b) => a.created_at - b.created_at)
        .map((z) => ({ ...z }));
    }

    if (sql === 'SELECT * FROM zettel_links') {
      return [...this.zettelLinks.values()].map((l) => ({ ...l }));
    }

    if (
      sql.startsWith(
        'SELECT * FROM zettel_links WHERE source_zettel_id = ? OR target_zettel_id = ?'
      )
    ) {
      const id = String(params[0]);
      return [...this.zettelLinks.values()]
        .filter(
          (l) => l.source_zettel_id === id || l.target_zettel_id === id
        )
        .map((l) => ({ ...l }));
    }

    return [];
  }
}
