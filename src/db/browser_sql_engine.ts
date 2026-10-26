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

interface EngineSnapshot {
  readonly label: string;
  readonly nextRowId: number;
  readonly canvases: Map<string, Record<string, unknown>>;
  readonly layers: Map<string, Record<string, unknown>>;
  readonly spatialNodes: Map<string, SpatialNodeRow>;
  readonly rtree: Map<number, RTreeEntry>;
  readonly asyncJobs: Map<string, AsyncJobRow>;
  readonly zettels: Map<string, ZettelRow>;
  readonly zettelLinks: Map<string, ZettelLinkRow>;
}

const SPATIAL_CELL_SIZE = 256;
const MAX_BUCKET_QUERY_CELLS = 4096;

/**
 * 2D Spatial Grid-Tree Index for sub-linear viewport/lasso AABB queries in the browser.
 * Maps 256x256 world-space cells to sets of 64-bit integer `rowid`s.
 */
class SpatialGridIndex {
  private readonly buckets = new Map<string, Set<number>>();
  private readonly rowCells = new Map<number, string[]>();
  private readonly oversizedRowIds = new Set<number>();

  public upsert(entry: RTreeEntry): void {
    this.remove(entry.id);
    const cMinX = Math.floor(entry.min_x / SPATIAL_CELL_SIZE);
    const cMaxX = Math.floor(entry.max_x / SPATIAL_CELL_SIZE);
    const cMinY = Math.floor(entry.min_y / SPATIAL_CELL_SIZE);
    const cMaxY = Math.floor(entry.max_y / SPATIAL_CELL_SIZE);
    if ((cMaxX - cMinX + 1) * (cMaxY - cMinY + 1) > 256) {
      this.oversizedRowIds.add(entry.id);
      return;
    }
    const cells = this.computeCells(
      entry.min_x,
      entry.min_y,
      entry.max_x,
      entry.max_y
    );
    this.rowCells.set(entry.id, cells);
    for (const key of cells) {
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = new Set<number>();
        this.buckets.set(key, bucket);
      }
      bucket.add(entry.id);
    }
  }

  public remove(rowid: number): void {
    this.oversizedRowIds.delete(rowid);
    const prevCells = this.rowCells.get(rowid);
    if (!prevCells) return;
    for (const key of prevCells) {
      const bucket = this.buckets.get(key);
      if (bucket) {
        bucket.delete(rowid);
        if (bucket.size === 0) {
          this.buckets.delete(key);
        }
      }
    }
    this.rowCells.delete(rowid);
  }

  public clear(): void {
    this.buckets.clear();
    this.rowCells.clear();
    this.oversizedRowIds.clear();
  }

  public rebuildFrom(rtree: ReadonlyMap<number, RTreeEntry>): void {
    this.clear();
    for (const entry of rtree.values()) {
      this.upsert(entry);
    }
  }

  public queryCandidateRowIds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    allEntries: ReadonlyMap<number, RTreeEntry>
  ): Set<number> {
    const cMinX = Math.floor(minX / SPATIAL_CELL_SIZE);
    const cMaxX = Math.floor(maxX / SPATIAL_CELL_SIZE);
    const cMinY = Math.floor(minY / SPATIAL_CELL_SIZE);
    const cMaxY = Math.floor(maxY / SPATIAL_CELL_SIZE);
    const totalCells = (cMaxX - cMinX + 1) * (cMaxY - cMinY + 1);

    const matching = new Set<number>();
    if (totalCells <= MAX_BUCKET_QUERY_CELLS) {
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        for (let cy = cMinY; cy <= cMaxY; cy++) {
          const bucket = this.buckets.get(`${cx}:${cy}`);
          if (!bucket) continue;
          for (const rowid of bucket) {
            const entry = allEntries.get(rowid);
            if (
              entry &&
              entry.max_x >= minX &&
              entry.min_x <= maxX &&
              entry.max_y >= minY &&
              entry.min_y <= maxY
            ) {
              matching.add(rowid);
            }
          }
        }
      }
      for (const rowid of this.oversizedRowIds) {
        const entry = allEntries.get(rowid);
        if (
          entry &&
          entry.max_x >= minX &&
          entry.min_x <= maxX &&
          entry.max_y >= minY &&
          entry.min_y <= maxY
        ) {
          matching.add(rowid);
        }
      }
      return matching;
    }

    // Fallback when querying an ultra-wide world frustum (>4096 cells)
    for (const entry of allEntries.values()) {
      if (
        entry.max_x >= minX &&
        entry.min_x <= maxX &&
        entry.max_y >= minY &&
        entry.min_y <= maxY
      ) {
        matching.add(entry.id);
      }
    }
    return matching;
  }

  private computeCells(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): string[] {
    const cMinX = Math.floor(minX / SPATIAL_CELL_SIZE);
    const cMaxX = Math.floor(maxX / SPATIAL_CELL_SIZE);
    const cMinY = Math.floor(minY / SPATIAL_CELL_SIZE);
    const cMaxY = Math.floor(maxY / SPATIAL_CELL_SIZE);
    const keys: string[] = [];
    for (let cx = cMinX; cx <= cMaxX; cx++) {
      for (let cy = cMinY; cy <= cMaxY; cy++) {
        keys.push(`${cx}:${cy}`);
      }
    }
    return keys;
  }
}

/**
 * Browser-safe synchronous SQL + R-Tree engine implementing `SqlEnginePort`.
 * Enforces identical transactional rollback, trigger, foreign-key cascade, and
 * 2D spatial indexing semantics to `schema.sql` with zero Node.js dependencies.
 */
export class BrowserSqlEngine implements SqlEnginePort {
  private nextRowId = 1;
  private canvases = new Map<string, Record<string, unknown>>();
  private layers = new Map<string, Record<string, unknown>>();
  private spatialNodes = new Map<string, SpatialNodeRow>();
  private spatialNodesByRowId = new Map<number, SpatialNodeRow>();
  private rtree = new Map<number, RTreeEntry>();
  private readonly spatialIndex = new SpatialGridIndex();
  private asyncJobs = new Map<string, AsyncJobRow>();
  private zettels = new Map<string, ZettelRow>();
  private zettelLinks = new Map<string, ZettelLinkRow>();
  private readonly transactionStack: EngineSnapshot[] = [];

  public exec(sql: string): void {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized === 'BEGIN IMMEDIATE;' || normalized === 'BEGIN;') {
      this.pushSnapshot('ROOT');
      return;
    }
    if (normalized === 'COMMIT;') {
      this.popSnapshot('ROOT');
      return;
    }
    if (normalized === 'ROLLBACK;') {
      this.rollbackToSnapshot('ROOT');
      return;
    }
    if (normalized.startsWith('SAVEPOINT ')) {
      const label = normalized.replace('SAVEPOINT ', '').replace(';', '').trim();
      this.pushSnapshot(label);
      return;
    }
    if (normalized.startsWith('RELEASE SAVEPOINT ')) {
      const label = normalized
        .replace('RELEASE SAVEPOINT ', '')
        .replace(';', '')
        .trim();
      this.popSnapshot(label);
      return;
    }
    if (normalized.startsWith('ROLLBACK TO SAVEPOINT ')) {
      const label = normalized
        .replace('ROLLBACK TO SAVEPOINT ', '')
        .replace(';', '')
        .trim();
      this.rollbackToSnapshot(label);
      return;
    }
  }

  public close(): void {
    this.canvases.clear();
    this.layers.clear();
    this.spatialNodes.clear();
    this.spatialNodesByRowId.clear();
    this.rtree.clear();
    this.spatialIndex.clear();
    this.asyncJobs.clear();
    this.zettels.clear();
    this.zettelLinks.clear();
    this.transactionStack.length = 0;
  }

  public prepare(sql: string): SqlStatementPort {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    return {
      run: (...params: unknown[]) => this.executeRun(normalized, params),
      get: (...params: unknown[]) => this.executeGet(normalized, params),
      all: (...params: unknown[]) => this.executeAll(normalized, params),
    };
  }

  private pushSnapshot(label: string): void {
    this.transactionStack.push({
      label,
      nextRowId: this.nextRowId,
      canvases: new Map(
        [...this.canvases.entries()].map(([k, v]) => [k, { ...v }])
      ),
      layers: new Map(
        [...this.layers.entries()].map(([k, v]) => [k, { ...v }])
      ),
      spatialNodes: new Map(
        [...this.spatialNodes.entries()].map(([k, v]) => [k, { ...v }])
      ),
      rtree: new Map([...this.rtree.entries()].map(([k, v]) => [k, { ...v }])),
      asyncJobs: new Map(
        [...this.asyncJobs.entries()].map(([k, v]) => [k, { ...v }])
      ),
      zettels: new Map(
        [...this.zettels.entries()].map(([k, v]) => [k, { ...v }])
      ),
      zettelLinks: new Map(
        [...this.zettelLinks.entries()].map(([k, v]) => [k, { ...v }])
      ),
    });
  }

  private popSnapshot(label: string): void {
    for (let i = this.transactionStack.length - 1; i >= 0; i--) {
      if (this.transactionStack[i]!.label === label) {
        this.transactionStack.splice(i);
        return;
      }
    }
  }

  private rollbackToSnapshot(label: string): void {
    for (let i = this.transactionStack.length - 1; i >= 0; i--) {
      const snap = this.transactionStack[i]!;
      if (snap.label === label) {
        this.nextRowId = snap.nextRowId;
        this.canvases = snap.canvases;
        this.layers = snap.layers;
        this.spatialNodes = snap.spatialNodes;
        this.spatialNodesByRowId.clear();
        for (const node of this.spatialNodes.values()) {
          this.spatialNodesByRowId.set(node.rowid, node);
        }
        this.rtree = snap.rtree;
        this.spatialIndex.rebuildFrom(this.rtree);
        this.asyncJobs = snap.asyncJobs;
        this.zettels = snap.zettels;
        this.zettelLinks = snap.zettelLinks;
        this.transactionStack.splice(i);
        return;
      }
    }
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
          z_index: Number(params[4]),
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
      this.spatialNodesByRowId.set(rowid, row);
      // Trigger: sync_rtree_insert / sync_rtree_update
      const rtreeEntry: RTreeEntry = {
        id: rowid,
        min_x: row.min_x,
        max_x: row.max_x,
        min_y: row.min_y,
        max_y: row.max_y,
      };
      this.rtree.set(rowid, rtreeEntry);
      this.spatialIndex.upsert(rtreeEntry);
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

    if (
      sql.startsWith(
        'UPDATE spatial_nodes SET min_x = ?, min_y = ?, max_x = ?, max_y = ?, content_json = ?, semantic_tags_json = ?, updated_at = ? WHERE id = ?'
      )
    ) {
      const minX = Number(params[0]);
      const minY = Number(params[1]);
      const maxX = Number(params[2]);
      const maxY = Number(params[3]);
      const contentJson = (params[4] as string | null) ?? null;
      const semanticTagsJson = (params[5] as string | null) ?? null;
      const updatedAt = Number(params[6]);
      const id = String(params[7]);

      const row = this.spatialNodes.get(id);
      if (row) {
        row.min_x = minX;
        row.min_y = minY;
        row.max_x = maxX;
        row.max_y = maxY;
        row.content_json = contentJson;
        row.semantic_tags_json = semanticTagsJson;
        row.updated_at = updatedAt;

        const rtreeEntry: RTreeEntry = {
          id: row.rowid,
          min_x: minX,
          max_x: maxX,
          min_y: minY,
          max_y: maxY,
        };
        this.rtree.set(row.rowid, rtreeEntry);
        this.spatialIndex.upsert(rtreeEntry);
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
        const rtreeEntry: RTreeEntry = {
          id: row.rowid,
          min_x: minX,
          max_x: maxX,
          min_y: minY,
          max_y: maxY,
        };
        this.rtree.set(row.rowid, rtreeEntry);
        this.spatialIndex.upsert(rtreeEntry);
      }
      return;
    }

    if (sql.startsWith('DELETE FROM spatial_nodes WHERE id IN')) {
      const idsToDelete = new Set(params.map(String));
      for (const id of idsToDelete) {
        const existing = this.spatialNodes.get(id);
        if (existing) {
          this.spatialNodes.delete(id);
          this.spatialNodesByRowId.delete(existing.rowid);
          // Trigger: sync_rtree_delete
          this.rtree.delete(existing.rowid);
          this.spatialIndex.remove(existing.rowid);
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

    throw new Error(`BrowserSqlEngine: unsupported run() SQL statement: ${sql}`);
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
        anchor_layer_id: anchor.layer_id,
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

    throw new Error(`BrowserSqlEngine: unsupported get() SQL statement: ${sql}`);
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
      sql.includes(
        "WHERE canvas_id = ? AND layer_id = ? AND node_type = 'stroke_cluster'"
      )
    ) {
      const canvasId = String(params[0]);
      const layerId = String(params[1]);
      return [...this.spatialNodes.values()]
        .filter(
          (n) =>
            n.canvas_id === canvasId &&
            n.layer_id === layerId &&
            n.node_type === 'stroke_cluster'
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

      const matchingRowIds = this.spatialIndex.queryCandidateRowIds(
        vMinX,
        vMinY,
        vMaxX,
        vMaxY,
        this.rtree
      );

      const candidates: SpatialNodeRow[] = [];
      for (const rowid of matchingRowIds) {
        const node = this.spatialNodesByRowId.get(rowid);
        if (node && node.canvas_id === canvasId) {
          candidates.push({ ...node });
        }
      }

      return candidates.sort((a, b) => {
        const zA = Number(this.layers.get(a.layer_id)?.z_index ?? 0);
        const zB = Number(this.layers.get(b.layer_id)?.z_index ?? 0);
        if (zA !== zB) return zA - zB;
        if (a.created_at !== b.created_at) return a.created_at - b.created_at;
        return a.id.localeCompare(b.id);
      });
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
          anchor_layer_id: anchor.layer_id,
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
          anchor_layer_id: anchor.layer_id,
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

    throw new Error(`BrowserSqlEngine: unsupported all() SQL statement: ${sql}`);
  }
}
