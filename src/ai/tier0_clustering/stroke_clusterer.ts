import {
  nodeId,
  worldAABB,
  type CanvasId,
  type LayerId,
  type NodeId,
  type SemanticColor,
  type WorldAABB,
} from '../../core/canvas/types.js';
import type { NoteFlowDatabase } from '../../db/client.js';
import type {
  SpatialNodeRecord,
  SpatialNodeRepository,
} from '../../db/repositories/spatial_node_repository.js';
import type { AsyncJobQueue } from '../../state/async_job_queue.js';

export const TIER0_DEBOUNCE_MS = 1200;
export const CLUSTER_MAX_GAP_X = 48;
export const CLUSTER_MAX_GAP_Y = 24;

export interface StrokeCommittedNotification {
  readonly strokeId: NodeId;
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly colorId: SemanticColor;
}

function areBoxesSpatiallyProximate(a: WorldAABB, b: WorldAABB): boolean {
  const gapX = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]));
  const gapY = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
  return gapX < CLUSTER_MAX_GAP_X && gapY < CLUSTER_MAX_GAP_Y;
}

function unionAABBs(boxes: readonly WorldAABB[]): WorldAABB {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b[0] < minX) minX = b[0];
    if (b[1] < minY) minY = b[1];
    if (b[2] > maxX) maxX = b[2];
    if (b[3] > maxY) maxY = b[3];
  }
  return worldAABB(minX, minY, maxX, maxY);
}

export class Tier0StrokeClusterer {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly nodeRepo: SpatialNodeRepository,
    private readonly jobQueue: AsyncJobQueue
  ) {}

  /**
   * Schedules Tier 0 clustering after 1200ms of pen inactivity, or executes
   * immediately (0ms) when the stroke uses the Violet AI Highlighter (`violet`).
   */
  public notifyStrokeCommitted(notification: StrokeCommittedNotification): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (notification.colorId === 'violet') {
      this.clusterLayerNow(
        notification.canvasId,
        notification.layerId,
        notification.strokeId
      );
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.clusterLayerNow(notification.canvasId, notification.layerId);
    }, TIER0_DEBOUNCE_MS);
  }

  /**
   * Runs Spatial Union-Find over unclustered strokes in the given layer, creates
   * `stroke_cluster` parent nodes, and enqueues a `verify_claim` job if triggered
   * by a Violet AI Highlighter stroke.
   */
  public clusterLayerNow(
    targetCanvasId: CanvasId,
    targetLayerId: LayerId,
    violetTriggerStrokeId?: NodeId
  ): NodeId[] {
    const unclustered = this.nodeRepo.getUnclusteredStrokesInLayer(
      targetCanvasId,
      targetLayerId
    );
    if (unclustered.length === 0) return [];

    // Disjoint-Set (Union-Find) over unclustered strokes
    const parent = unclustered.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const union = (i: number, j: number): void => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) {
        parent[rootJ] = rootI;
      }
    };

    for (let i = 0; i < unclustered.length; i++) {
      for (let j = i + 1; j < unclustered.length; j++) {
        if (
          areBoxesSpatiallyProximate(unclustered[i]!.bbox, unclustered[j]!.bbox)
        ) {
          union(i, j);
        }
      }
    }

    const groups = new Map<number, SpatialNodeRecord[]>();
    for (let i = 0; i < unclustered.length; i++) {
      const root = find(i);
      let list = groups.get(root);
      if (!list) {
        list = [];
        groups.set(root, list);
      }
      list.push(unclustered[i]!);
    }

    const createdClusterIds: NodeId[] = [];

    this.db.transaction(() => {
      for (const members of groups.values()) {
        const newClusterId = nodeId(crypto.randomUUID());
        const combinedBbox = unionAABBs(members.map((m) => m.bbox));
        const tagSet = new Set<string>();
        for (const m of members) {
          for (const t of m.semanticTags) tagSet.add(t);
        }

        const memberIds = members.map((m) => m.id);
        this.nodeRepo.insertNode({
          id: newClusterId,
          canvasId: targetCanvasId,
          layerId: targetLayerId,
          nodeType: 'stroke_cluster',
          parentClusterId: null,
          bbox: combinedBbox,
          strokePoints: null,
          style: null,
          contentJson: { strokeCount: members.length },
          ocrText: null,
          semanticTags: [...tagSet],
        });

        this.nodeRepo.assignNodesToCluster(memberIds, newClusterId);
        createdClusterIds.push(newClusterId);

        const isVioletTriggered =
          tagSet.has('violet') ||
          (violetTriggerStrokeId !== undefined &&
            memberIds.includes(violetTriggerStrokeId));

        if (isVioletTriggered) {
          this.jobQueue.enqueueClusterJob({
            canvasId: targetCanvasId,
            anchorClusterId: newClusterId,
            jobType: 'verify_claim',
            memberStrokeIds: memberIds,
          });
        }
      }
    });

    return createdClusterIds;
  }
}
