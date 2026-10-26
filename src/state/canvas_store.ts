import {
  canvasId,
  layerId,
  nodeId,
  screenPoint,
  worldAABB,
  worldPoint,
  type CameraState,
  type CanvasId,
  type JobId,
  type LayerId,
  type NodeId,
  type ScreenPoint,
  type StrokeStyle,
  type WorldAABB,
  type WorldPoint,
} from '../core/canvas/types.js';
import {
  computeStrokeAABB,
  isPointInPolygon,
  rotateCameraWithSnap,
  screenToWorld,
  worldToScreen,
  zoomAroundPoint,
} from '../core/canvas/math.js';
import {
  CommitStrokeCommand,
  CommandHistory,
} from '../core/commands/canvas_command.js';
import { NoteFlowDatabase } from '../db/client.js';
import {
  SpatialNodeRepository,
  type LayerType,
  type SpatialNodeRecord,
} from '../db/repositories/spatial_node_repository.js';
import {
  AsyncJobRepository,
  type AsyncJobBadgeRecord,
  type AsyncJobStatus,
  type AsyncJobType,
} from '../db/repositories/async_job_repository.js';
import { AsyncJobQueue } from './async_job_queue.js';
import { Tier0StrokeClusterer } from '../ai/tier0_clustering/stroke_clusterer.js';

export type RadialToolSlot =
  | 'fountain_pen'
  | 'felt_tip_marker'
  | 'ai_highlighter'
  | 'stroke_eraser'
  | 'freehand_lasso'
  | 'pan_laser';

export interface SmartLayerState {
  readonly id: LayerId;
  readonly name: string;
  readonly layerType: LayerType;
  readonly zIndex: number;
  isVisible: boolean;
  isLocked: boolean;
  opacity: number;
}

export interface ProjectedJobBadge {
  readonly id: JobId;
  readonly anchorNodeId: NodeId;
  readonly jobType: AsyncJobType;
  readonly status: AsyncJobStatus;
  readonly worldAnchorX: number;
  readonly worldAnchorY: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly resultJson: Record<string, unknown> | null;
}

export interface UnifiedSceneFrame {
  readonly camera: CameraState;
  readonly worldViewport: WorldAABB;
  readonly visibleNodes: readonly SpatialNodeRecord[];
  readonly badges: readonly ProjectedJobBadge[];
}

export class CanvasStore {
  public readonly db: NoteFlowDatabase;
  public readonly nodeRepo: SpatialNodeRepository;
  public readonly jobRepo: AsyncJobRepository;
  public readonly jobQueue: AsyncJobQueue;
  public readonly clusterer: Tier0StrokeClusterer;
  public readonly history: CommandHistory;
  public readonly canvasId: CanvasId;

  private _camera: CameraState = { panX: 0, panY: 0, zoom: 1.0, rotation: 0 };
  private _activeTool: RadialToolSlot = 'fountain_pen';
  private _strokeStyle: StrokeStyle = {
    colorId: 'noir',
    width: 2.8,
    brushType: 'pen',
  };
  private _isTeachingMode = false;
  private readonly layersByType = new Map<LayerType, SmartLayerState>();

  public constructor(db: NoteFlowDatabase, title: string) {
    this.db = db;
    this.nodeRepo = new SpatialNodeRepository(db);
    this.jobRepo = new AsyncJobRepository(db);
    this.jobQueue = new AsyncJobQueue(db, this.nodeRepo, this.jobRepo);
    this.clusterer = new Tier0StrokeClusterer(db, this.nodeRepo, this.jobQueue);
    this.history = new CommandHistory({
      onCancelJobsForNodes: (ids) => {
        this.jobQueue.cancelJobsForNodes(ids);
      },
    });
    this.canvasId = canvasId(crypto.randomUUID());

    const defaultLayers: Array<{
      layerType: LayerType;
      name: string;
      zIndex: number;
    }> = [
      { layerType: 'notes', name: 'My Notes', zIndex: 0 },
      { layerType: 'hints_work', name: 'Hints & Scratchpad', zIndex: 1 },
      {
        layerType: 'ai_feedback',
        name: 'AI Annotations & Verification',
        zIndex: 2,
      },
      { layerType: 'math_formal', name: 'LaTeX & Formal Proofs', zIndex: 3 },
    ];

    for (const def of defaultLayers) {
      const id = layerId(crypto.randomUUID());
      this.nodeRepo.ensureCanvasAndLayer({
        canvasId: this.canvasId,
        canvasTitle: title,
        layerId: id,
        layerName: def.name,
        layerType: def.layerType,
        zIndex: def.zIndex,
      });
      this.layersByType.set(def.layerType, {
        id,
        name: def.name,
        layerType: def.layerType,
        zIndex: def.zIndex,
        isVisible: true,
        isLocked: false,
        opacity: 1.0,
      });
    }
  }

  public static createInMemory(title: string = 'Untitled Canvas'): CanvasStore {
    return new CanvasStore(NoteFlowDatabase.createInMemory(), title);
  }

  public get camera(): CameraState {
    return this._camera;
  }

  public get activeTool(): RadialToolSlot {
    return this._activeTool;
  }

  public get strokeStyle(): StrokeStyle {
    return this._strokeStyle;
  }

  public get isTeachingMode(): boolean {
    return this._isTeachingMode;
  }

  public getLayerByType(type: LayerType): SmartLayerState {
    return this.layersByType.get(type)!;
  }

  public getAllLayers(): readonly SmartLayerState[] {
    return [...this.layersByType.values()].sort((a, b) => a.zIndex - b.zIndex);
  }

  public setStrokeColor(colorId: StrokeStyle['colorId']): void {
    this._strokeStyle = {
      ...this._strokeStyle,
      colorId,
    };
  }

  public setStrokeWidth(width: number): void {
    this._strokeStyle = {
      ...this._strokeStyle,
      width,
    };
  }

  public selectRadialTool(tool: RadialToolSlot): void {
    this._activeTool = tool;
    if (tool === 'fountain_pen') {
      this._strokeStyle = {
        ...this._strokeStyle,
        brushType: 'pen',
        colorId:
          this._strokeStyle.colorId === 'violet'
            ? 'noir'
            : this._strokeStyle.colorId,
      };
    } else if (tool === 'felt_tip_marker') {
      this._strokeStyle = {
        ...this._strokeStyle,
        brushType: 'marker',
      };
    } else if (tool === 'ai_highlighter') {
      this._strokeStyle = {
        colorId: 'violet',
        width: 6.0,
        brushType: 'highlighter',
      };
    }
  }

  /**
   * One-tap Teaching Mode Toggle (`docs/SPEC.md` §3.2):
   * Hides Layer 1 (`hints_work`) and Layer 2 (`ai_feedback`) when presenting.
   */
  public setTeachingMode(enabled: boolean): void {
    this._isTeachingMode = enabled;
    const hints = this.layersByType.get('hints_work')!;
    const aiFeedback = this.layersByType.get('ai_feedback')!;
    hints.isVisible = !enabled;
    aiFeedback.isVisible = !enabled;
  }

  public panCamera(dx: number, dy: number): void {
    this._camera = {
      ...this._camera,
      panX: this._camera.panX + dx,
      panY: this._camera.panY + dy,
    };
  }

  public zoomCamera(focal: ScreenPoint, zoomDeltaRatio: number): void {
    this._camera = zoomAroundPoint(this._camera, focal, zoomDeltaRatio);
  }

  public rotateCamera(newRotationRad: number): void {
    this._camera = rotateCameraWithSnap(this._camera, newRotationRad);
  }

  public commitStroke(params: {
    layerId: LayerId;
    points: Float32Array;
    style?: StrokeStyle;
  }): NodeId {
    const newId = nodeId(crypto.randomUUID());
    const style = params.style ?? this._strokeStyle;
    const bbox = computeStrokeAABB(params.points, style.width);

    const cmd = new CommitStrokeCommand(this.db, this.nodeRepo, {
      id: newId,
      canvasId: this.canvasId,
      layerId: params.layerId,
      bbox,
      points: params.points,
      style,
    });
    this.history.execute(cmd);

    this.clusterer.notifyStrokeCommitted({
      strokeId: newId,
      canvasId: this.canvasId,
      layerId: params.layerId,
      colorId: style.colorId,
    });

    return newId;
  }

  /**
   * Builds the Unified Dry Scene Graph Frame (`docs/SPEC.md` §4):
   * Queries R-Tree for the current camera frustum, filters by visible Smart Layers,
   * and projects AI status badges through the exact same `CameraState` matrix.
   */
  public buildSceneFrame(
    viewportWidth: number,
    viewportHeight: number
  ): UnifiedSceneFrame {
    const corners = [
      screenToWorld(screenPoint(0, 0), this._camera),
      screenToWorld(screenPoint(viewportWidth, 0), this._camera),
      screenToWorld(screenPoint(viewportWidth, viewportHeight), this._camera),
      screenToWorld(screenPoint(0, viewportHeight), this._camera),
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }

    const worldViewport = worldAABB(minX, minY, maxX, maxY);
    const visibleLayerIds = new Set<LayerId>();
    for (const layer of this.layersByType.values()) {
      if (layer.isVisible) visibleLayerIds.add(layer.id);
    }

    const rtreeNodes = this.nodeRepo.queryViewportRTree(
      this.canvasId,
      worldViewport
    );
    const visibleNodes = rtreeNodes.filter((n) => visibleLayerIds.has(n.layerId));

    const rawBadges = this.jobRepo.getBadgesForCanvas(this.canvasId);
    const badges: ProjectedJobBadge[] = rawBadges.map((b) => {
      const screenPos = worldToScreen(
        worldPoint(b.anchorX, b.anchorY),
        this._camera
      );
      return {
        id: b.id,
        anchorNodeId: b.anchorNodeId,
        jobType: b.jobType,
        status: b.status,
        worldAnchorX: b.anchorX,
        worldAnchorY: b.anchorY,
        screenX: screenPos.x,
        screenY: screenPos.y,
        resultJson: b.resultJson,
      };
    });

    return {
      camera: { ...this._camera },
      worldViewport,
      visibleNodes,
      badges,
    };
  }

  /**
   * Freehand Lasso Hit-Testing (`docs/SPEC.md` §5.2 & `vector-ink-math` skill):
   * 1. Queries R-Tree using the polygon's bounding box.
   * 2. Refines candidates using ray-casting `isPointInPolygon`.
   */
  public selectNodesInLasso(
    polygon: readonly WorldPoint[]
  ): SpatialNodeRecord[] {
    if (polygon.length < 3) return [];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of polygon) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }

    const candidates = this.nodeRepo.queryViewportRTree(
      this.canvasId,
      worldAABB(minX, minY, maxX, maxY)
    );

    return candidates.filter((node) => {
      if (node.strokePoints && node.strokePoints.length >= 2) {
        for (let i = 0; i < node.strokePoints.length; i += 4) {
          const pt = worldPoint(
            node.strokePoints[i]!,
            node.strokePoints[i + 1]!
          );
          if (isPointInPolygon(pt, polygon)) return true;
        }
        return false;
      }

      const center = worldPoint(
        (node.bbox[0] + node.bbox[2]) / 2,
        (node.bbox[1] + node.bbox[3]) / 2
      );
      return isPointInPolygon(center, polygon);
    });
  }

  /**
   * Circle-to-Action Gesture (`docs/SPEC.md` §5.2):
   * Immediately clusters the lassoed strokes (0ms debounce) and enqueues the
   * requested AI synthesis/verification job.
   */
  public triggerCircleToAction(
    polygon: readonly WorldPoint[],
    jobType: AsyncJobType = 'synthesize_zettel'
  ): AsyncJobBadgeRecord | null {
    const selected = this.selectNodesInLasso(polygon).filter(
      (n) => n.nodeType === 'vector_stroke'
    );
    if (selected.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const tagSet = new Set<string>();
    for (const s of selected) {
      if (s.bbox[0] < minX) minX = s.bbox[0];
      if (s.bbox[1] < minY) minY = s.bbox[1];
      if (s.bbox[2] > maxX) maxX = s.bbox[2];
      if (s.bbox[3] > maxY) maxY = s.bbox[3];
      for (const t of s.semanticTags) tagSet.add(t);
    }

    const clusterId = nodeId(crypto.randomUUID());
    const targetLayerId = selected[0]!.layerId;
    const memberIds = selected.map((s) => s.id);

    return this.db.transaction(() => {
      this.nodeRepo.insertNode({
        id: clusterId,
        canvasId: this.canvasId,
        layerId: targetLayerId,
        nodeType: 'stroke_cluster',
        parentClusterId: null,
        bbox: worldAABB(minX, minY, maxX, maxY),
        strokePoints: null,
        style: null,
        contentJson: { strokeCount: selected.length, trigger: 'circle_to_action' },
        ocrText: null,
        semanticTags: [...tagSet],
      });

      this.nodeRepo.assignNodesToCluster(memberIds, clusterId);

      return this.jobQueue.enqueueClusterJob({
        canvasId: this.canvasId,
        anchorClusterId: clusterId,
        jobType,
        memberStrokeIds: memberIds,
      });
    });
  }

  public close(): void {
    this.db.close();
  }
}
