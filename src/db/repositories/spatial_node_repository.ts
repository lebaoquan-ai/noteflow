import { z } from 'zod';
import { areStrokeBoxesProximate } from '../../core/canvas/math.js';
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

const RawCanvasRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  camera_state_json: z.string(),
  updated_at: z.number().int(),
});

const RawLayerRowSchema = z.object({
  id: z.string().uuid(),
  canvas_id: z.string().uuid(),
  name: z.string(),
  layer_type: LayerTypeSchema,
  z_index: z.number().int(),
  is_visible: z.number().int(),
  is_locked: z.number().int(),
  opacity: z.number().finite(),
});

export interface HydratedCanvasRecord {
  readonly canvasId: CanvasId;
  readonly title: string;
  readonly cameraStateJson: string;
  readonly layers: readonly {
    readonly id: LayerId;
    readonly name: string;
    readonly layerType: LayerType;
    readonly zIndex: number;
    readonly isVisible: boolean;
    readonly isLocked: boolean;
    readonly opacity: number;
  }[];
}

export class SpatialNodeRepository {
  public constructor(private readonly db: NoteFlowDatabase) {}

  public getPrimaryCanvasWithLayers(): HydratedCanvasRecord | null {
    const rawCanvas = this.db.raw
      .prepare(
        'SELECT id, title, camera_state_json, updated_at FROM canvases ORDER BY updated_at DESC LIMIT 1'
      )
      .get();
    if (!rawCanvas) return null;
    const parsedCanvas = RawCanvasRowSchema.parse(rawCanvas);
    const rawLayers = this.db.raw
      .prepare(
        'SELECT id, canvas_id, name, layer_type, z_index, is_visible, is_locked, opacity FROM layers WHERE canvas_id = ? ORDER BY z_index ASC'
      )
      .all(parsedCanvas.id);

    const layers = rawLayers.map((raw) => {
      const l = RawLayerRowSchema.parse(raw);
      return {
        id: layerId(l.id),
        name: l.name,
        layerType: l.layer_type,
        zIndex: l.z_index,
        isVisible: l.is_visible !== 0,
        isLocked: l.is_locked !== 0,
        opacity: l.opacity,
      };
    });

    return {
      canvasId: canvasId(parsedCanvas.id),
      title: parsedCanvas.title,
      cameraStateJson: parsedCanvas.camera_state_json,
      layers,
    };
  }

  public updateCanvasCamera(
    targetCanvasId: CanvasId,
    cameraStateJson: string
  ): void {
    this.db.raw
      .prepare(
        'UPDATE canvases SET camera_state_json = ?, updated_at = ? WHERE id = ?'
      )
      .run(cameraStateJson, Date.now(), targetCanvasId);
  }

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

  public getClustersInLayer(
    targetCanvasId: CanvasId,
    targetLayerId: LayerId
  ): SpatialNodeRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM spatial_nodes
         WHERE canvas_id = ? AND layer_id = ? AND node_type = 'stroke_cluster'
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

  public updateClusterBoundsAndTags(
    clusterId: NodeId,
    bbox: WorldAABB,
    strokeCount: number,
    semanticTags: readonly string[]
  ): void {
    const existing = this.getById(clusterId);
    if (!existing) return;
    const now = Date.now();
    const nextContent: Record<string, unknown> = {
      ...(existing.contentJson ?? {}),
      strokeCount,
    };
    this.db.raw
      .prepare(
        `UPDATE spatial_nodes SET min_x = ?, min_y = ?, max_x = ?, max_y = ?, content_json = ?, semantic_tags_json = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        bbox[0],
        bbox[1],
        bbox[2],
        bbox[3],
        JSON.stringify(nextContent),
        JSON.stringify(semanticTags),
        now,
        clusterId
      );
  }

  public updateNodeMetadata(
    nodeId: NodeId,
    params: {
      readonly contentJson: Record<string, unknown> | null;
      readonly ocrText: string | null;
      readonly semanticTags: readonly string[];
    }
  ): void {
    const now = Date.now();
    this.db.raw
      .prepare(
        `UPDATE spatial_nodes SET content_json = ?, ocr_text = ?, semantic_tags_json = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        params.contentJson ? JSON.stringify(params.contentJson) : null,
        params.ocrText,
        JSON.stringify(params.semanticTags),
        now,
        nodeId
      );
  }

  /**
   * Re-evaluates each specified `stroke_cluster` after child strokes have been
   * undone, erased, or sliced:
   * - If the cluster has 0 remaining child strokes, deletes the cluster node so no
   *   orphaned dashed boxes remain on the canvas.
   * - If removing a bridging stroke splits the remaining child strokes into multiple
   *   disconnected spatial components (> 48px apart), partitions them into separate
   *   `stroke_cluster` nodes and returns the newly created split cluster IDs.
   * - Otherwise, recomputes its bounding box, strokeCount, and semanticTags from
   *   its remaining child strokes.
   */
  public pruneOrUpdateParentClusters(
    clusterIds: readonly NodeId[]
  ): NodeId[] {
    const uniqueClusterIds = [...new Set(clusterIds)];
    if (uniqueClusterIds.length === 0) return [];

    const createdSplitClusterIds: NodeId[] = [];

    this.db.transaction(() => {
      for (const cId of uniqueClusterIds) {
        const cluster = this.getById(cId);
        if (!cluster || cluster.nodeType !== 'stroke_cluster') continue;

        const children = this.getChildStrokesOfClusters([cId]);
        if (children.length === 0) {
          this.deleteByIds([cId]);
          continue;
        }

        // Partition remaining children into connected components using canonical anisotropic proximity
        const n = children.length;
        const parent = Array.from({ length: n }, (_, idx) => idx);
        const find = (x: number): number => {
          let root = x;
          while (parent[root] !== root) root = parent[root]!;
          let curr = x;
          while (curr !== root) {
            const nxt = parent[curr]!;
            parent[curr] = root;
            curr = nxt;
          }
          return root;
        };
        const union = (a: number, b: number): void => {
          const ra = find(a);
          const rb = find(b);
          if (ra !== rb) parent[rb] = ra;
        };

        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (areStrokeBoxesProximate(children[i]!.bbox, children[j]!.bbox)) {
              union(i, j);
            }
          }
        }

        const componentsMap = new Map<number, SpatialNodeRecord[]>();
        for (let i = 0; i < n; i++) {
          const r = find(i);
          let list = componentsMap.get(r);
          if (!list) {
            list = [];
            componentsMap.set(r, list);
          }
          list.push(children[i]!);
        }

        const components = [...componentsMap.values()];
        const computeBoundsAndTags = (
          members: readonly SpatialNodeRecord[]
        ): { bbox: WorldAABB; tags: string[] } => {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          const tagSet = new Set<string>();
          for (const child of members) {
            if (child.bbox[0] < minX) minX = child.bbox[0];
            if (child.bbox[1] < minY) minY = child.bbox[1];
            if (child.bbox[2] > maxX) maxX = child.bbox[2];
            if (child.bbox[3] > maxY) maxY = child.bbox[3];
            for (const t of child.semanticTags) tagSet.add(t);
          }
          return {
            bbox: worldAABB(minX, minY, maxX, maxY),
            tags: [...tagSet],
          };
        };

        const primaryComp = components[0]!;
        const primaryStats = computeBoundsAndTags(primaryComp);
        this.updateClusterBoundsAndTags(
          cId,
          primaryStats.bbox,
          primaryComp.length,
          primaryStats.tags
        );

        for (let k = 1; k < components.length; k++) {
          const splitComp = components[k]!;
          const splitStats = computeBoundsAndTags(splitComp);
          const splitClusterId = nodeId(crypto.randomUUID());
          this.insertNode({
            id: splitClusterId,
            canvasId: cluster.canvasId,
            layerId: cluster.layerId,
            nodeType: 'stroke_cluster',
            parentClusterId: null,
            bbox: splitStats.bbox,
            strokePoints: null,
            style: null,
            contentJson: { strokeCount: splitComp.length },
            ocrText: null,
            semanticTags: splitStats.tags,
          });
          this.assignNodesToCluster(
            splitComp.map((s) => s.id),
            splitClusterId
          );
          createdSplitClusterIds.push(splitClusterId);
        }
      }
    });

    return createdSplitClusterIds;
  }

  /**
   * Queries the R-Tree virtual table using the 64-bit integer rowid join,
   * ordered by layer z_index ASC and creation timestamp ASC.
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
         INNER JOIN layers l ON n.layer_id = l.id
         WHERE n.canvas_id = ?
           AND r.max_x >= ? AND r.min_x <= ?
           AND r.max_y >= ? AND r.min_y <= ?
         ORDER BY l.z_index ASC, n.created_at ASC, n.id ASC`
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
