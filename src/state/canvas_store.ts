import {
  CameraStateSchema,
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
  ClusterStrokesCommand,
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
import { ZettelRepository } from '../db/repositories/zettel_repository.js';
import { AutoZettelSyncer } from '../ai/zettel_sync/auto_zettel_syncer.js';

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
  readonly layers?: ReadonlyMap<LayerId, SmartLayerState>;
}

export class CanvasStore {
  public readonly db: NoteFlowDatabase;
  public readonly nodeRepo: SpatialNodeRepository;
  public readonly jobRepo: AsyncJobRepository;
  public readonly zettelRepo: ZettelRepository;
  public readonly jobQueue: AsyncJobQueue;
  public readonly clusterer: Tier0StrokeClusterer;
  public readonly zettelSyncer: AutoZettelSyncer;
  public readonly history: CommandHistory;
  private _canvasId!: CanvasId;

  private _camera: CameraState = { panX: 0, panY: 0, zoom: 1.0, rotation: 0 };
  private _activeTool: RadialToolSlot = 'fountain_pen';
  private _activeLayerType: LayerType = 'notes';
  private _strokeStyle: StrokeStyle = {
    colorId: 'noir',
    width: 2.8,
    brushType: 'pen',
  };
  private _isTeachingMode = false;
  private _rotationLocked = true;
  private readonly layersByType = new Map<LayerType, SmartLayerState>();
  private readonly layersById = new Map<LayerId, SmartLayerState>();

  public constructor(db: NoteFlowDatabase, title: string = 'Untitled Canvas') {
    this.db = db;
    this.nodeRepo = new SpatialNodeRepository(db);
    this.jobRepo = new AsyncJobRepository(db);
    this.zettelRepo = new ZettelRepository(db);
    this.jobQueue = new AsyncJobQueue(db, this.nodeRepo, this.jobRepo);
    this.clusterer = new Tier0StrokeClusterer(db, this.nodeRepo, this.jobQueue);
    this.zettelSyncer = new AutoZettelSyncer(
      db,
      this.nodeRepo,
      this.zettelRepo,
      this.clusterer
    );
    this.history = new CommandHistory({
      onCancelJobsForNodes: (ids) => {
        this.jobQueue.cancelJobsForNodes(ids);
      },
      onRedoCommand: (command) => {
        if (command instanceof CommitStrokeCommand) {
          if (command.restoredClusterId) {
            this.clusterer.ensureClusterBadgeIfViolet(
              this.canvasId,
              command.restoredClusterId
            );
          } else {
            this.clusterer.notifyStrokeCommitted({
              strokeId: command.params.id,
              canvasId: command.params.canvasId,
              layerId: command.params.layerId,
              colorId: command.params.style.colorId,
            });
          }
        } else if (
          command instanceof ClusterStrokesCommand &&
          command.params.jobType
        ) {
          this.jobQueue.enqueueClusterJob({
            canvasId: command.params.canvasId,
            anchorClusterId: command.params.clusterId,
            jobType: command.params.jobType,
            memberStrokeIds: command.params.memberStrokeIds,
          });
        }
      },
    });

    this.syncFromDatabase(title);
  }

  public get canvasId(): CanvasId {
    return this._canvasId;
  }

  public syncFromDatabase(title: string = 'Untitled Canvas'): void {
    this.layersByType.clear();
    this.layersById.clear();

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

    const existingCanvas = this.nodeRepo.getPrimaryCanvasWithLayers();
    if (existingCanvas) {
      this._canvasId = existingCanvas.canvasId;
      try {
        const parsedCamera = CameraStateSchema.safeParse(
          JSON.parse(existingCanvas.cameraStateJson)
        );
        if (parsedCamera.success) {
          this._camera = parsedCamera.data;
        }
      } catch {
        // Keep default camera if JSON is malformed
      }

      for (const l of existingCanvas.layers) {
        const state: SmartLayerState = {
          id: l.id,
          name: l.name,
          layerType: l.layerType,
          zIndex: l.zIndex,
          isVisible: l.isVisible,
          isLocked: l.isLocked,
          opacity: l.opacity,
        };
        this.layersByType.set(l.layerType, state);
        this.layersById.set(l.id, state);
      }

      for (const def of defaultLayers) {
        if (!this.layersByType.has(def.layerType)) {
          const id = layerId(crypto.randomUUID());
          this.nodeRepo.ensureCanvasAndLayer({
            canvasId: this._canvasId,
            canvasTitle: existingCanvas.title,
            layerId: id,
            layerName: def.name,
            layerType: def.layerType,
            zIndex: def.zIndex,
          });
          const state: SmartLayerState = {
            id,
            name: def.name,
            layerType: def.layerType,
            zIndex: def.zIndex,
            isVisible: true,
            isLocked: false,
            opacity: 1.0,
          };
          this.layersByType.set(def.layerType, state);
          this.layersById.set(id, state);
        }
      }
    } else {
      this._canvasId = canvasId(crypto.randomUUID());

      for (const def of defaultLayers) {
        const id = layerId(crypto.randomUUID());
        this.nodeRepo.ensureCanvasAndLayer({
          canvasId: this._canvasId,
          canvasTitle: title,
          layerId: id,
          layerName: def.name,
          layerType: def.layerType,
          zIndex: def.zIndex,
        });
        const state: SmartLayerState = {
          id,
          name: def.name,
          layerType: def.layerType,
          zIndex: def.zIndex,
          isVisible: true,
          isLocked: false,
          opacity: 1.0,
        };
        this.layersByType.set(def.layerType, state);
        this.layersById.set(id, state);
      }
    }
  }

  public static createInMemory(title: string = 'Untitled Canvas'): CanvasStore {
    return new CanvasStore(NoteFlowDatabase.createInMemory(), title);
  }

  public static fromDatabase(
    db: NoteFlowDatabase,
    title: string = 'Untitled Canvas'
  ): CanvasStore {
    return new CanvasStore(db, title);
  }

  public get rotationLocked(): boolean {
    return this._rotationLocked;
  }

  public setRotationLocked(locked: boolean): void {
    this._rotationLocked = locked;
  }

  public get camera(): CameraState {
    return this._camera;
  }

  public get activeTool(): RadialToolSlot {
    return this._activeTool;
  }

  public get activeLayer(): SmartLayerState {
    return this.layersByType.get(this._activeLayerType)!;
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

  public getLayerById(id: LayerId): SmartLayerState | undefined {
    return this.layersById.get(id);
  }

  public getAllLayers(): readonly SmartLayerState[] {
    return [...this.layersByType.values()].sort((a, b) => a.zIndex - b.zIndex);
  }

  public getEditableLayerIds(): ReadonlySet<LayerId> {
    const ids = new Set<LayerId>();
    for (const layer of this.layersByType.values()) {
      if (layer.isVisible && !layer.isLocked) {
        ids.add(layer.id);
      }
    }
    return ids;
  }

  public setActiveLayer(type: LayerType): void {
    if (!this.layersByType.has(type)) {
      throw new Error(`Unknown layer type: ${type}`);
    }
    this._activeLayerType = type;
  }

  public setLayerLocked(type: LayerType, locked: boolean): void {
    const layer = this.getLayerByType(type);
    layer.isLocked = locked;
  }

  public setLayerOpacity(type: LayerType, opacity: number): void {
    const layer = this.getLayerByType(type);
    layer.opacity = Math.max(0, Math.min(1, opacity));
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
    this.nodeRepo.updateCanvasCamera(
      this._canvasId,
      JSON.stringify(this._camera)
    );
  }

  public zoomCamera(focal: ScreenPoint, zoomDeltaRatio: number): void {
    this._camera = zoomAroundPoint(this._camera, focal, zoomDeltaRatio);
    this.nodeRepo.updateCanvasCamera(
      this._canvasId,
      JSON.stringify(this._camera)
    );
  }

  public rotateCamera(newRotationRad: number): void {
    this._camera = rotateCameraWithSnap(this._camera, newRotationRad);
    this.nodeRepo.updateCanvasCamera(
      this._canvasId,
      JSON.stringify(this._camera)
    );
  }

  public commitStroke(params: {
    layerId: LayerId;
    points: Float32Array;
    style?: StrokeStyle;
    ocrText?: string;
    semanticTags?: readonly string[];
  }): NodeId {
    const targetLayer = this.layersById.get(params.layerId);
    if (targetLayer?.isLocked) {
      throw new Error(`Cannot commit stroke to locked layer "${targetLayer.name}".`);
    }

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
      ocrText: params.ocrText ?? null,
      semanticTags: params.semanticTags,
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

  public syncZettelkastenNow(targetLayerId?: LayerId): void {
    const lId = targetLayerId ?? this.activeLayer.id;
    this.zettelSyncer.syncLayer(this.canvasId, lId);
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

    const aiFeedbackVisible =
      this.layersByType.get('ai_feedback')?.isVisible ?? true;
    const rawBadges = aiFeedbackVisible
      ? this.jobRepo.getBadgesForCanvas(this.canvasId)
      : [];
    const badges: ProjectedJobBadge[] = rawBadges
      .filter((b) => visibleLayerIds.has(b.anchorLayerId))
      .map((b) => {
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
      layers: new Map(
        [...this.layersById.entries()].map(([k, v]) => [k, { ...v }])
      ),
    };
  }

  /**
   * Hit-tests projected AI status badges in screen space.
   * Matches the rendered badge center offset `(screenX + 8, screenY - 8)` in `DualCanvasRenderer`.
   */
  public hitTestBadgeAtScreenPoint(
    pt: ScreenPoint,
    viewportWidth: number,
    viewportHeight: number,
    hitRadiusPx: number = 18
  ): ProjectedJobBadge | null {
    const frame = this.buildSceneFrame(viewportWidth, viewportHeight);
    let closest: ProjectedJobBadge | null = null;
    let bestDist = hitRadiusPx;
    for (const badge of frame.badges) {
      const cx = badge.screenX + 8;
      const cy = badge.screenY - 8;
      const dist = Math.hypot(pt.x - cx, pt.y - cy);
      if (dist <= bestDist) {
        bestDist = dist;
        closest = badge;
      }
    }
    return closest;
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

    const editableLayerIds = this.getEditableLayerIds();
    const candidates = this.nodeRepo.queryViewportRTree(
      this.canvasId,
      worldAABB(minX, minY, maxX, maxY)
    );

    return candidates.filter((node) => {
      if (!editableLayerIds.has(node.layerId)) return false;
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
   * Immediately clusters the lassoed strokes (0ms debounce) through an undoable
   * `ClusterStrokesCommand` and enqueues the requested AI synthesis/verification job.
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
      const clusterCmd = new ClusterStrokesCommand(this.db, this.nodeRepo, {
        clusterId,
        canvasId: this.canvasId,
        layerId: targetLayerId,
        memberStrokeIds: memberIds,
        bbox: worldAABB(minX, minY, maxX, maxY),
        semanticTags: [...tagSet],
        contentJson: { strokeCount: selected.length, trigger: 'circle_to_action' },
        jobType,
      });
      this.history.execute(clusterCmd);

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
