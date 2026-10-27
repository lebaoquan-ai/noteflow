import {
  areStrokeBoxesProximate,
  STROKE_CLUSTER_MAX_GAP_X,
  STROKE_CLUSTER_MAX_GAP_Y,
} from '../../core/canvas/math.js';
import {
  nodeId,
  worldAABB,
  type CanvasId,
  type LayerId,
  type NodeId,
  type SemanticColor,
  type WorldAABB,
} from '../../core/canvas/types.js';
import { ClusterStrokesCommand } from '../../core/commands/canvas_command.js';
import type { NoteFlowDatabase } from '../../db/client.js';
import type {
  SpatialNodeRecord,
  SpatialNodeRepository,
} from '../../db/repositories/spatial_node_repository.js';
import type { AsyncJobQueue } from '../../state/async_job_queue.js';
import { detectPointingArrowStroke } from '../ink_recognition/vector_topology_analyzer.js';

export const TIER0_DEBOUNCE_MS = 1200;
export const CLUSTER_MAX_GAP_X = STROKE_CLUSTER_MAX_GAP_X;
export const CLUSTER_MAX_GAP_Y = STROKE_CLUSTER_MAX_GAP_Y;

export interface StrokeCommittedNotification {
  readonly strokeId: NodeId;
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly colorId: SemanticColor;
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
   * Runs Spatial Union-Find over unclustered strokes AND existing `stroke_cluster`s
   * in the given layer, creates or merges `stroke_cluster` parent nodes via
   * `ClusterStrokesCommand`, and enqueues a `verify_claim` job if triggered by a
   * Violet AI Highlighter stroke.
   */
  public clusterLayerNow(
    targetCanvasId: CanvasId,
    targetLayerId: LayerId,
    violetTriggerStrokeId?: NodeId
  ): NodeId[] {
    const rawUnclustered = this.nodeRepo.getUnclusteredStrokesInLayer(
      targetCanvasId,
      targetLayerId
    );
    // Pointing-arrow connector strokes (A ──> B) act as directed spatial relations
    // between clusters and must NOT bridge/merge two separate clusters.
    const unclustered = rawUnclustered.filter(
      (s) => detectPointingArrowStroke(s) === null
    );
    if (unclustered.length === 0) return [];

    const existingClusters = this.nodeRepo.getClustersInLayer(
      targetCanvasId,
      targetLayerId
    );
    const allExistingChildren =
      existingClusters.length > 0
        ? this.nodeRepo.getChildStrokesOfClusters(
            existingClusters.map((c) => c.id)
          )
        : [];
    const childrenByClusterId = new Map<NodeId, SpatialNodeRecord[]>();
    for (const child of allExistingChildren) {
      if (!child.parentClusterId) continue;
      let list = childrenByClusterId.get(child.parentClusterId);
      if (!list) {
        list = [];
        childrenByClusterId.set(child.parentClusterId, list);
      }
      list.push(child);
    }

    const items = [...existingClusters, ...unclustered];
    const parent = items.map((_, i) => i);
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

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        // At least one item must be a newly added unclustered stroke
        if (i < existingClusters.length && j < existingClusters.length) {
          continue;
        }
        const itemI = items[i]!;
        const itemJ = items[j]!;
        // Fast coarse AABB check first
        if (!areStrokeBoxesProximate(itemI.bbox, itemJ.bbox)) {
          continue;
        }
        // If itemI is an existing cluster, verify proximity against at least one constituent child stroke
        // so L-shaped or multi-line clusters do not falsely absorb strokes in empty corners of their coarse AABB.
        if (i < existingClusters.length) {
          const clusterChildren = childrenByClusterId.get(itemI.id) ?? [];
          const nearAnyChild =
            clusterChildren.length === 0
              ? true
              : clusterChildren.some((child) =>
                  areStrokeBoxesProximate(child.bbox, itemJ.bbox)
                );
          if (!nearAnyChild) {
            continue;
          }
        }
        union(i, j);
      }
    }

    const groups = new Map<
      number,
      {
        existingClusters: SpatialNodeRecord[];
        newStrokes: SpatialNodeRecord[];
      }
    >();

    for (let i = 0; i < items.length; i++) {
      const root = find(i);
      let entry = groups.get(root);
      if (!entry) {
        entry = { existingClusters: [], newStrokes: [] };
        groups.set(root, entry);
      }
      if (i < existingClusters.length) {
        entry.existingClusters.push(items[i]!);
      } else {
        entry.newStrokes.push(items[i]!);
      }
    }

    const createdOrUpdatedClusterIds: NodeId[] = [];

    this.db.transaction(() => {
      for (const group of groups.values()) {
        if (group.newStrokes.length === 0) continue;

        const primaryExisting = group.existingClusters[0] ?? null;
        const targetClusterId = primaryExisting
          ? primaryExisting.id
          : nodeId(crypto.randomUUID());

        const existingChildren =
          group.existingClusters.length > 0
            ? this.nodeRepo.getChildStrokesOfClusters(
                group.existingClusters.map((c) => c.id)
              )
            : [];

        const allMemberStrokes = [...existingChildren, ...group.newStrokes];
        const allMemberIds = allMemberStrokes.map((m) => m.id);
        const combinedBbox = unionAABBs(allMemberStrokes.map((m) => m.bbox));

        const tagSet = new Set<string>();
        for (const m of allMemberStrokes) {
          for (const t of m.semanticTags) tagSet.add(t);
        }

        const obsoleteClusterIds = group.existingClusters
          .slice(1)
          .map((c) => c.id);

        const clusterCmd = new ClusterStrokesCommand(this.db, this.nodeRepo, {
          clusterId: targetClusterId,
          canvasId: targetCanvasId,
          layerId: targetLayerId,
          memberStrokeIds: allMemberIds,
          bbox: combinedBbox,
          semanticTags: [...tagSet],
          contentJson: { strokeCount: allMemberIds.length },
          obsoleteClusterIdsToDelete: obsoleteClusterIds,
        });
        clusterCmd.execute();
        this.jobQueue.cancelJobsForNodes([
          targetClusterId,
          ...obsoleteClusterIds,
        ]);

        createdOrUpdatedClusterIds.push(targetClusterId);

        const newStrokesHaveViolet = group.newStrokes.some(
          (s) =>
            s.semanticTags.includes('violet') ||
            (violetTriggerStrokeId !== undefined &&
              s.id === violetTriggerStrokeId)
        );

        if (newStrokesHaveViolet || tagSet.has('violet')) {
          this.jobQueue.enqueueClusterJob({
            canvasId: targetCanvasId,
            anchorClusterId: targetClusterId,
            jobType: 'verify_claim',
            memberStrokeIds: allMemberIds,
          });
        }
      }
    });

    return createdOrUpdatedClusterIds;
  }

  /**
   * Re-enqueues a `verify_claim` badge on `clusterId` when a Violet cluster is restored via Redo.
   */
  public ensureClusterBadgeIfViolet(
    targetCanvasId: CanvasId,
    clusterId: NodeId
  ): void {
    const cluster = this.nodeRepo.getById(clusterId);
    if (!cluster || cluster.nodeType !== 'stroke_cluster') return;
    const children = this.nodeRepo.getChildStrokesOfClusters([clusterId]);
    const hasViolet =
      cluster.semanticTags.includes('violet') ||
      children.some((c) => c.semanticTags.includes('violet'));
    if (!hasViolet) return;

    this.jobQueue.cancelJobsForNodes([clusterId]);
    this.jobQueue.enqueueClusterJob({
      canvasId: targetCanvasId,
      anchorClusterId: clusterId,
      jobType: 'verify_claim',
      memberStrokeIds: children.map((c) => c.id),
    });
  }
}
