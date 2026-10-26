import {
  nodeId,
  worldAABB,
  type CanvasId,
  type NodeId,
  type WorldPoint,
} from '../canvas/types.js';
import { computeStrokeAABB } from '../canvas/math.js';
import type { NoteFlowDatabase } from '../../db/client.js';
import type {
  SpatialNodeRecord,
  SpatialNodeRepository,
} from '../../db/repositories/spatial_node_repository.js';
import type { CanvasCommand } from './canvas_command.js';

function ccw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  return (
    ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
    ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
  );
}

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(px - ax, py - ay);
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

export class SliceEraseCommand implements CanvasCommand {
  public readonly kind = 'SLICE_ERASE';
  private deletedSnapshots: SpatialNodeRecord[] = [];
  private parentClusterSnapshots: SpatialNodeRecord[] = [];
  private siblingStrokeSnapshots: SpatialNodeRecord[] = [];
  private splitClusterIdsCreated: NodeId[] = [];
  private createdFragments: SpatialNodeRecord[] = [];
  private _affectedNodeIds: NodeId[] = [];
  private hasExecutedOnce = false;

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly repo: SpatialNodeRepository,
    private readonly canvasId: CanvasId,
    private readonly bladeStart: WorldPoint,
    private readonly bladeEnd: WorldPoint,
    private readonly eraserRadius: number = 4.0,
    public readonly gestureId?: number
  ) {}

  public get affectedNodeIds(): readonly NodeId[] {
    return this._affectedNodeIds;
  }

  public get didMutate(): boolean {
    return this.deletedSnapshots.length > 0;
  }

  public execute(): void {
    if (this.hasExecutedOnce) {
      this.db.transaction(() => {
        const strokeIdsToDelete = this.deletedSnapshots.map((s) => s.id);
        if (strokeIdsToDelete.length > 0) {
          this.repo.deleteByIds(strokeIdsToDelete);
        }
        if (this.createdFragments.length > 0) {
          this.repo.restoreSnapshots(this.createdFragments);
        }
        const parentClusterIds = this.parentClusterSnapshots.map((c) => c.id);
        if (parentClusterIds.length > 0) {
          this.splitClusterIdsCreated =
            this.repo.pruneOrUpdateParentClusters(parentClusterIds);
        } else {
          this.splitClusterIdsCreated = [];
        }
      });
      return;
    }

    const minX = Math.min(this.bladeStart.x, this.bladeEnd.x) - this.eraserRadius;
    const minY = Math.min(this.bladeStart.y, this.bladeEnd.y) - this.eraserRadius;
    const maxX = Math.max(this.bladeStart.x, this.bladeEnd.x) + this.eraserRadius;
    const maxY = Math.max(this.bladeStart.y, this.bladeEnd.y) + this.eraserRadius;

    const candidates = this.repo
      .queryViewportRTree(this.canvasId, worldAABB(minX, minY, maxX, maxY))
      .filter((n) => n.nodeType === 'vector_stroke' && n.strokePoints !== null);

    this.deletedSnapshots = [];
    this.parentClusterSnapshots = [];
    this.siblingStrokeSnapshots = [];
    this.splitClusterIdsCreated = [];
    this.createdFragments = [];
    this._affectedNodeIds = [];

    if (candidates.length === 0) {
      this.hasExecutedOnce = true;
      return;
    }

    const plannedSplits: Array<{
      stroke: SpatialNodeRecord;
      subChains: number[][];
    }> = [];

    for (const stroke of candidates) {
      const pts = stroke.strokePoints!;
      const numPts = Math.floor(pts.length / 4);
      if (numPts === 0) continue;

      const subChains: number[][] = [];
      let currentChain: number[] = [];
      let wasCut = false;

      for (let i = 0; i < numPts; i++) {
        const x = pts[i * 4]!;
        const y = pts[i * 4 + 1]!;
        const p = pts[i * 4 + 2]!;
        const t = pts[i * 4 + 3]!;

        const pointHit =
          pointToSegmentDist(
            x,
            y,
            this.bladeStart.x,
            this.bladeStart.y,
            this.bladeEnd.x,
            this.bladeEnd.y
          ) <= this.eraserRadius;

        if (pointHit) {
          wasCut = true;
          if (currentChain.length > 0) {
            subChains.push(currentChain);
            currentChain = [];
          }
          continue;
        }

        currentChain.push(x, y, p, t);

        if (i < numPts - 1) {
          const nx = pts[(i + 1) * 4]!;
          const ny = pts[(i + 1) * 4 + 1]!;
          const segHit = segmentsIntersect(
            x,
            y,
            nx,
            ny,
            this.bladeStart.x,
            this.bladeStart.y,
            this.bladeEnd.x,
            this.bladeEnd.y
          );
          if (segHit) {
            wasCut = true;
            subChains.push(currentChain);
            currentChain = [];
          }
        }
      }

      if (currentChain.length > 0) {
        subChains.push(currentChain);
      }

      if (wasCut) {
        plannedSplits.push({ stroke, subChains });
      }
    }

    if (plannedSplits.length === 0) {
      this.hasExecutedOnce = true;
      return;
    }

    const affectedClusterIds = new Set<NodeId>();
    const plannedStrokeIds = new Set<NodeId>();
    for (const { stroke } of plannedSplits) {
      plannedStrokeIds.add(stroke.id);
      if (stroke.parentClusterId) {
        affectedClusterIds.add(stroke.parentClusterId);
      }
    }

    this.db.transaction(() => {
      if (affectedClusterIds.size > 0) {
        this.parentClusterSnapshots = this.repo.getByIds([
          ...affectedClusterIds,
        ]);
        this.siblingStrokeSnapshots = this.repo
          .getChildStrokesOfClusters([...affectedClusterIds])
          .filter((c) => !plannedStrokeIds.has(c.id));
      }

      for (const { stroke, subChains } of plannedSplits) {
        this.deletedSnapshots.push(stroke);
        this._affectedNodeIds.push(stroke.id);
        this.repo.deleteByIds([stroke.id]);

        const style = stroke.style ?? {
          colorId: 'noir',
          width: 2.8,
          brushType: 'pen',
        };

        for (const chain of subChains) {
          if (chain.length < 4) continue;
          const fragmentPts = new Float32Array(chain);
          const fragId = nodeId(crypto.randomUUID());
          const fragBbox = computeStrokeAABB(fragmentPts, style.width);

          const insertedFrag = this.repo.insertNode({
            id: fragId,
            canvasId: stroke.canvasId,
            layerId: stroke.layerId,
            nodeType: 'vector_stroke',
            parentClusterId: stroke.parentClusterId,
            bbox: fragBbox,
            strokePoints: fragmentPts,
            style,
            contentJson: null,
            ocrText: null,
            semanticTags: stroke.semanticTags,
            createdAt: stroke.createdAt,
            updatedAt: Date.now(),
          });
          this.createdFragments.push(insertedFrag);
        }
      }

      if (affectedClusterIds.size > 0) {
        this.splitClusterIdsCreated = this.repo.pruneOrUpdateParentClusters([
          ...affectedClusterIds,
        ]);
        for (const cId of affectedClusterIds) {
          if (!this._affectedNodeIds.includes(cId)) {
            this._affectedNodeIds.push(cId);
          }
        }
      }
    });

    this.hasExecutedOnce = true;
  }

  public tryMergeWith(next: CanvasCommand): boolean {
    if (
      !(next instanceof SliceEraseCommand) ||
      this.gestureId === undefined ||
      next.gestureId !== this.gestureId
    ) {
      return false;
    }

    const existingClusterIds = new Set(this.parentClusterSnapshots.map((c) => c.id));
    for (const c of next.parentClusterSnapshots) {
      if (!existingClusterIds.has(c.id)) {
        existingClusterIds.add(c.id);
        this.parentClusterSnapshots.push(c);
      }
    }

    const createdFragMap = new Map(this.createdFragments.map((f) => [f.id, f]));
    const existingDeletedIds = new Set(this.deletedSnapshots.map((s) => s.id));
    const siblingMap = new Map(this.siblingStrokeSnapshots.map((s) => [s.id, s]));

    for (const deleted of next.deletedSnapshots) {
      if (createdFragMap.has(deleted.id)) {
        // Intermediate fragment created earlier in the same drag was sliced again
        createdFragMap.delete(deleted.id);
      } else if (!existingDeletedIds.has(deleted.id)) {
        existingDeletedIds.add(deleted.id);
        this.deletedSnapshots.push(deleted);
        siblingMap.delete(deleted.id);
      }
    }

    for (const sib of next.siblingStrokeSnapshots) {
      if (
        !siblingMap.has(sib.id) &&
        !existingDeletedIds.has(sib.id) &&
        !createdFragMap.has(sib.id)
      ) {
        siblingMap.set(sib.id, sib);
      }
    }
    this.siblingStrokeSnapshots = [...siblingMap.values()];

    for (const frag of next.createdFragments) {
      createdFragMap.set(frag.id, frag);
    }
    this.createdFragments = [...createdFragMap.values()];

    for (const splitId of next.splitClusterIdsCreated) {
      if (!this.splitClusterIdsCreated.includes(splitId)) {
        this.splitClusterIdsCreated.push(splitId);
      }
    }

    for (const id of next._affectedNodeIds) {
      if (!this._affectedNodeIds.includes(id)) {
        this._affectedNodeIds.push(id);
      }
    }

    return true;
  }

  public undo(): void {
    this.db.transaction(() => {
      if (this.splitClusterIdsCreated.length > 0) {
        this.repo.deleteByIds(this.splitClusterIdsCreated);
        this.splitClusterIdsCreated = [];
      }
      if (this.createdFragments.length > 0) {
        this.repo.deleteByIds(this.createdFragments.map((f) => f.id));
      }
      if (
        this.parentClusterSnapshots.length > 0 ||
        this.siblingStrokeSnapshots.length > 0 ||
        this.deletedSnapshots.length > 0
      ) {
        this.repo.restoreSnapshots([
          ...this.parentClusterSnapshots,
          ...this.siblingStrokeSnapshots,
          ...this.deletedSnapshots,
        ]);
      }
    });
  }
}
