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
  private createdFragmentIds: NodeId[] = [];
  private _affectedNodeIds: NodeId[] = [];

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly repo: SpatialNodeRepository,
    private readonly canvasId: CanvasId,
    private readonly bladeStart: WorldPoint,
    private readonly bladeEnd: WorldPoint,
    private readonly eraserRadius: number = 4.0
  ) {}

  public get affectedNodeIds(): readonly NodeId[] {
    return this._affectedNodeIds;
  }

  public execute(): void {
    const minX = Math.min(this.bladeStart.x, this.bladeEnd.x) - this.eraserRadius;
    const minY = Math.min(this.bladeStart.y, this.bladeEnd.y) - this.eraserRadius;
    const maxX = Math.max(this.bladeStart.x, this.bladeEnd.x) + this.eraserRadius;
    const maxY = Math.max(this.bladeStart.y, this.bladeEnd.y) + this.eraserRadius;

    const candidates = this.repo
      .queryViewportRTree(this.canvasId, worldAABB(minX, minY, maxX, maxY))
      .filter((n) => n.nodeType === 'vector_stroke' && n.strokePoints !== null);

    this.deletedSnapshots = [];
    this.createdFragmentIds = [];
    this._affectedNodeIds = [];

    this.db.transaction(() => {
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

        if (!wasCut) continue;

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

          this.repo.insertNode({
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
          this.createdFragmentIds.push(fragId);
        }
      }
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      if (this.createdFragmentIds.length > 0) {
        this.repo.deleteByIds(this.createdFragmentIds);
      }
      if (this.deletedSnapshots.length > 0) {
        this.repo.restoreSnapshots(this.deletedSnapshots);
      }
    });
  }
}
