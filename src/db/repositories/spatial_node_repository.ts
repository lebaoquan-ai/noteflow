import { z } from 'zod';
import {
  canvasId,
  layerId,
  nodeId,
  StrokeStyleSchema,
  worldAABB,
  type CanvasId,
  type LayerId,
  type NodeId,
  type StrokeStyle,
  type WorldAABB,
} from '../../core/canvas/types.js';
import type { NoteFlowDatabase } from '../client.js';

export const SpatialNodeTypeSchema = z.enum([
  'vector_stroke',
  'stroke_cluster',
  'zettel_card',
  'math_block',
  'media_item',
  'portal',
]);

export type SpatialNodeType = z.infer<typeof SpatialNodeTypeSchema>;

export const LayerTypeSchema = z.enum([
  'notes',
  'hints_work',
  'ai_feedback',
  'math_formal',
]);

export type LayerType = z.infer<typeof LayerTypeSchema>;

const RawSpatialNodeRowSchema = z.object({
  id: z.string().uuid(),
  canvas_id: z.string().uuid(),
  layer_id: z.string().uuid(),
  node_type: SpatialNodeTypeSchema,
  parent_cluster_id: z.string().uuid().nullable(),
  min_x: z.number().finite(),
  min_y: z.number().finite(),
  max_x: z.number().finite(),
  max_y: z.number().finite(),
  stroke_points: z.instanceof(Uint8Array).nullable(),
  style_json: z.string().nullable(),
  content_json: z.string().nullable(),
  ocr_text: z.string().nullable(),
  semantic_tags_json: z.string().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

export interface SpatialNodeRecord {
  readonly id: NodeId;
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly nodeType: SpatialNodeType;
  readonly parentClusterId: NodeId | null;
  readonly bbox: WorldAABB;
  readonly strokePoints: Float32Array | null;
  readonly style: StrokeStyle | null;
  readonly contentJson: Record<string, unknown> | null;
  readonly ocrText: string | null;
  readonly semanticTags: string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface InsertSpatialNodeInput {
  readonly id: NodeId;
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly nodeType: SpatialNodeType;
  readonly parentClusterId: NodeId | null;
  readonly bbox: WorldAABB;
  readonly strokePoints: Float32Array | null;
  readonly style: StrokeStyle | null;
  readonly contentJson: Record<string, unknown> | null;
  readonly ocrText: string | null;
  readonly semanticTags: readonly string[];
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

function float32ToUint8Blob(points: Float32Array | null): Uint8Array | null {
  if (!points) return null;
  return new Uint8Array(points.buffer, points.byteOffset, points.byteLength);
}

function uint8BlobToFloat32(blob: Uint8Array | null): Float32Array | null {
  if (!blob) return null;
  const aligned = new Uint8Array(blob.byteLength);
  aligned.set(blob);
  return new Float32Array(aligned.buffer);
}

function parseSpatialNodeRow(rawRow: unknown): SpatialNodeRecord {
  const row = RawSpatialNodeRowSchema.parse(rawRow);
  const style = row.style_json
    ? StrokeStyleSchema.parse(JSON.parse(row.style_json))
    : null;
  const contentJson = row.content_json
    ? z.record(z.string(), z.unknown()).parse(JSON.parse(row.content_json))
    : null;
  const semanticTags = row.semantic_tags_json
    ? z.array(z.string()).parse(JSON.parse(row.semantic_tags_json))
    : [];

  return {
    id: nodeId(row.id),
    canvasId: canvasId(row.canvas_id),
    layerId: layerId(row.layer_id),
    nodeType: row.node_type,
    parentClusterId: row.parent_cluster_id ? nodeId(row.parent_cluster_id) : null,
    bbox: worldAABB(row.min_x, row.min_y, row.max_x, row.max_y),
    strokePoints: uint8BlobToFloat32(row.stroke_points),
    style,
    contentJson,
    ocrText: row.ocr_text,
    semanticTags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SpatialNodeRepository {
  public constructor(private readonly db: NoteFlowDatabase) {}

  public ensureCanvasAndLayer(params: {
    canvasId: CanvasId;
    canvasTitle: string;
    layerId: LayerId;
    layerName: string;
    layerType: LayerType;
    zIndex: number;
  }): void {
    const now = Date.now();
    this.db.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT OR IGNORE INTO canvases (id, title, camera_state_json, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          params.canvasId,
          params.canvasTitle,
          JSON.stringify({ panX: 0, panY: 0, zoom: 1, rotation: 0 }),
          now
        );

      this.db.raw
        .prepare(
          `INSERT OR IGNORE INTO layers (id, canvas_id, name, layer_type, z_index, is_visible, is_locked, opacity)
           VALUES (?, ?, ?, ?, ?, 1, 0, 1.0)`
        )
        .run(
          params.layerId,
          params.canvasId,
          params.layerName,
          params.layerType,
          params.zIndex
        );
    });
  }

  public insertNode(input: InsertSpatialNodeInput): SpatialNodeRecord {
    const now = Date.now();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    this.db.raw
      .prepare(
        `INSERT INTO spatial_nodes (
          id, canvas_id, layer_id, node_type, parent_cluster_id,
          min_x, min_y, max_x, max_y,
          stroke_points, style_json, content_json, ocr_text, semantic_tags_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.canvasId,
        input.layerId,
        input.nodeType,
        input.parentClusterId,
        input.bbox[0],
        input.bbox[1],
        input.bbox[2],
        input.bbox[3],
        float32ToUint8Blob(input.strokePoints),
        input.style ? JSON.stringify(input.style) : null,
        input.contentJson ? JSON.stringify(input.contentJson) : null,
        input.ocrText,
        JSON.stringify(input.semanticTags),
        createdAt,
        updatedAt
      );

    return this.getById(input.id)!;
  }

  public getById(id: NodeId): SpatialNodeRecord | null {
    const row = this.db.raw
      .prepare(`SELECT * FROM spatial_nodes WHERE id = ?`)
      .get(id);
    if (!row) return null;
    return parseSpatialNodeRow(row);
  }

  public getByIds(ids: readonly NodeId[]): SpatialNodeRecord[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db.raw
      .prepare(`SELECT * FROM spatial_nodes WHERE id IN (${placeholders})`)
      .all(...ids);
    return rows.map(parseSpatialNodeRow);
  }

  public getAllForCanvas(targetCanvasId: CanvasId): SpatialNodeRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM spatial_nodes WHERE canvas_id = ? ORDER BY created_at ASC, id ASC`
      )
      .all(targetCanvasId);
    return rows.map(parseSpatialNodeRow);
  }

  public getUnclusteredStrokesInLayer(
    targetCanvasId: CanvasId,
    targetLayerId: LayerId
  ): SpatialNodeRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM spatial_nodes
         WHERE canvas_id = ? AND layer_id = ? AND node_type = 'vector_stroke' AND parent_cluster_id IS NULL
         ORDER BY created_at ASC`
      )
      .all(targetCanvasId, targetLayerId);
    return rows.map(parseSpatialNodeRow);
  }

  public getChildStrokesOfClusters(clusterIds: readonly NodeId[]): SpatialNodeRecord[] {
    if (clusterIds.length === 0) return [];
    const placeholders = clusterIds.map(() => '?').join(', ');
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM spatial_nodes WHERE parent_cluster_id IN (${placeholders})`
      )
      .all(...clusterIds);
    return rows.map(parseSpatialNodeRow);
  }

  public assignNodesToCluster(
    strokeIds: readonly NodeId[],
    clusterId: NodeId | null
  ): void {
    if (strokeIds.length === 0) return;
    const now = Date.now();
    this.db.transaction(() => {
      const stmt = this.db.raw.prepare(
        `UPDATE spatial_nodes SET parent_cluster_id = ?, updated_at = ? WHERE id = ?`
      );
      for (const id of strokeIds) {
        stmt.run(clusterId, now, id);
      }
    });
  }

  /**
   * Queries the R-Tree virtual table using the 64-bit integer rowid join.
   */
  public queryViewportRTree(
    targetCanvasId: CanvasId,
    viewport: WorldAABB
  ): SpatialNodeRecord[] {
    const [vMinX, vMinY, vMaxX, vMaxY] = viewport;
    const rows = this.db.raw
      .prepare(
        `SELECT n.*
         FROM spatial_nodes n
         INNER JOIN spatial_nodes_rtree r ON n.rowid = r.id
         WHERE n.canvas_id = ?
           AND r.max_x >= ? AND r.min_x <= ?
           AND r.max_y >= ? AND r.min_y <= ?
         ORDER BY n.created_at ASC`
      )
      .all(targetCanvasId, vMinX, vMaxX, vMinY, vMaxY);
    return rows.map(parseSpatialNodeRow);
  }

  /**
   * Atomically translates the specified nodes (and any child strokes belonging to
   * translated `stroke_cluster` nodes) by (dx, dy).
   * SQLite's `sync_rtree_update` trigger automatically updates `spatial_nodes_rtree`.
   */
  public translateBatch(
    targetNodeIds: readonly NodeId[],
    dx: number,
    dy: number
  ): void {
    if (targetNodeIds.length === 0) return;
    const now = Date.now();

    this.db.transaction(() => {
      const directNodes = this.getByIds(targetNodeIds);
      const childNodes = this.getChildStrokesOfClusters(targetNodeIds);

      const uniqueNodes = new Map<NodeId, SpatialNodeRecord>();
      for (const n of directNodes) uniqueNodes.set(n.id, n);
      for (const c of childNodes) uniqueNodes.set(c.id, c);

      const updateStmt = this.db.raw.prepare(
        `UPDATE spatial_nodes
         SET min_x = ?, min_y = ?, max_x = ?, max_y = ?, stroke_points = ?, updated_at = ?
         WHERE id = ?`
      );

      for (const node of uniqueNodes.values()) {
        const nextMinX = node.bbox[0] + dx;
        const nextMinY = node.bbox[1] + dy;
        const nextMaxX = node.bbox[2] + dx;
        const nextMaxY = node.bbox[3] + dy;

        let nextPoints: Float32Array | null = null;
        if (node.strokePoints) {
          nextPoints = new Float32Array(node.strokePoints.length);
          for (let i = 0; i < node.strokePoints.length; i += 4) {
            nextPoints[i] = node.strokePoints[i]! + dx;
            nextPoints[i + 1] = node.strokePoints[i + 1]! + dy;
            nextPoints[i + 2] = node.strokePoints[i + 2]!;
            nextPoints[i + 3] = node.strokePoints[i + 3]!;
          }
        }

        updateStmt.run(
          nextMinX,
          nextMinY,
          nextMaxX,
          nextMaxY,
          float32ToUint8Blob(nextPoints),
          now,
          node.id
        );
      }
    });
  }

  public deleteByIds(ids: readonly NodeId[]): void {
    if (ids.length === 0) return;
    this.db.transaction(() => {
      const placeholders = ids.map(() => '?').join(', ');
      this.db.raw
        .prepare(`DELETE FROM spatial_nodes WHERE id IN (${placeholders})`)
        .run(...ids);
    });
  }

  /**
   * Restores a batch of SpatialNodeRecord snapshots (e.g. during Undo of an Erase
   * or Cluster operation). Inserts parent/cluster nodes before child nodes so
   * foreign keys on `parent_cluster_id` are always satisfied.
   */
  public restoreSnapshots(snapshots: readonly SpatialNodeRecord[]): void {
    if (snapshots.length === 0) return;
    const sorted = [...snapshots].sort((a, b) => {
      if (a.parentClusterId === null && b.parentClusterId !== null) return -1;
      if (a.parentClusterId !== null && b.parentClusterId === null) return 1;
      return a.createdAt - b.createdAt;
    });

    this.db.transaction(() => {
      const stmt = this.db.raw.prepare(
        `INSERT OR REPLACE INTO spatial_nodes (
          id, canvas_id, layer_id, node_type, parent_cluster_id,
          min_x, min_y, max_x, max_y,
          stroke_points, style_json, content_json, ocr_text, semantic_tags_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const s of sorted) {
        stmt.run(
          s.id,
          s.canvasId,
          s.layerId,
          s.nodeType,
          s.parentClusterId,
          s.bbox[0],
          s.bbox[1],
          s.bbox[2],
          s.bbox[3],
          float32ToUint8Blob(s.strokePoints),
          s.style ? JSON.stringify(s.style) : null,
          s.contentJson ? JSON.stringify(s.contentJson) : null,
          s.ocrText,
          JSON.stringify(s.semanticTags),
          s.createdAt,
          s.updatedAt
        );
      }
    });
  }

  public countRTreeEntries(): number {
    const row = this.db.raw
      .prepare(`SELECT COUNT(*) AS count FROM spatial_nodes_rtree`)
      .get();
    const parsed = z.object({ count: z.number().int() }).parse(row);
    return parsed.count;
  }
}
