import type {
  CanvasId,
  LayerId,
  NodeId,
  StrokeStyle,
  WorldAABB,
} from '../canvas/types.js';
import type { NoteFlowDatabase } from '../../db/client.js';
import type {
  SpatialNodeRecord,
  SpatialNodeRepository,
} from '../../db/repositories/spatial_node_repository.js';

export interface CanvasCommand {
  readonly kind: string;
  readonly affectedNodeIds: readonly NodeId[];
  readonly didMutate?: boolean;
  execute(): void;
  undo(): void;
  tryMergeWith?(next: CanvasCommand): boolean;
}

export interface CommitStrokeParams {
  readonly id: NodeId;
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly bbox: WorldAABB;
  readonly points: Float32Array;
  readonly style: StrokeStyle;
  readonly createdAt?: number;
}

export class CommitStrokeCommand implements CanvasCommand {
  public readonly kind = 'COMMIT_STROKE';
  private readonly createdTimestamp: number;
  private parentClusterSnapshot: SpatialNodeRecord | null = null;
  private priorClusterChildrenIds: NodeId[] = [];
  private splitClusterIdsCreatedOnUndo: NodeId[] = [];

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly repo: SpatialNodeRepository,
    public readonly params: CommitStrokeParams
  ) {
    this.createdTimestamp = params.createdAt ?? Date.now();
  }

  public get restoredClusterId(): NodeId | null {
    return this.parentClusterSnapshot?.id ?? null;
  }

  public get affectedNodeIds(): readonly NodeId[] {
    if (this.parentClusterSnapshot) {
      return [this.params.id, this.parentClusterSnapshot.id];
    }
    return [this.params.id];
  }

  public execute(): void {
    this.db.transaction(() => {
      if (this.splitClusterIdsCreatedOnUndo.length > 0) {
        this.repo.deleteByIds(this.splitClusterIdsCreatedOnUndo);
        this.splitClusterIdsCreatedOnUndo = [];
      }
      if (this.parentClusterSnapshot) {
        this.repo.restoreSnapshots([this.parentClusterSnapshot]);
        if (this.priorClusterChildrenIds.length > 0) {
          this.repo.assignNodesToCluster(
            this.priorClusterChildrenIds,
            this.parentClusterSnapshot.id
          );
        }
      }
      this.repo.insertNode({
        id: this.params.id,
        canvasId: this.params.canvasId,
        layerId: this.params.layerId,
        nodeType: 'vector_stroke',
        parentClusterId: this.parentClusterSnapshot?.id ?? null,
        bbox: this.params.bbox,
        strokePoints: new Float32Array(this.params.points),
        style: this.params.style,
        contentJson: null,
        ocrText: null,
        semanticTags: [this.params.style.colorId],
        createdAt: this.createdTimestamp,
        updatedAt: this.createdTimestamp,
      });
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      const current = this.repo.getById(this.params.id);
      const parentClusterId = current?.parentClusterId ?? null;
      this.parentClusterSnapshot = parentClusterId
        ? this.repo.getById(parentClusterId)
        : null;
      this.priorClusterChildrenIds = parentClusterId
        ? this.repo
            .getChildStrokesOfClusters([parentClusterId])
            .filter((c) => c.id !== this.params.id)
            .map((c) => c.id)
        : [];

      this.repo.deleteByIds([this.params.id]);

      if (parentClusterId) {
        this.splitClusterIdsCreatedOnUndo =
          this.repo.pruneOrUpdateParentClusters([parentClusterId]);
      } else {
        this.splitClusterIdsCreatedOnUndo = [];
      }
    });
  }
}

export interface ClusterStrokesParams {
  readonly clusterId: NodeId;
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly memberStrokeIds: readonly NodeId[];
  readonly bbox: WorldAABB;
  readonly semanticTags: readonly string[];
  readonly contentJson: Record<string, unknown>;
  readonly obsoleteClusterIdsToDelete?: readonly NodeId[];
}

export class ClusterStrokesCommand implements CanvasCommand {
  public readonly kind = 'CLUSTER_STROKES';
  private beforeSnapshots: SpatialNodeRecord[] = [];
  private createdNewCluster = false;

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly repo: SpatialNodeRepository,
    private readonly params: ClusterStrokesParams
  ) {}

  public get affectedNodeIds(): readonly NodeId[] {
    return [
      this.params.clusterId,
      ...this.params.memberStrokeIds,
      ...(this.params.obsoleteClusterIdsToDelete ?? []),
    ];
  }

  public execute(): void {
    this.db.transaction(() => {
      const existingCluster = this.repo.getById(this.params.clusterId);
      this.createdNewCluster = existingCluster === null;

      const strokes = this.repo.getByIds(this.params.memberStrokeIds);
      const priorParentClusterIds = new Set<NodeId>();
      for (const s of strokes) {
        if (s.parentClusterId && s.parentClusterId !== this.params.clusterId) {
          priorParentClusterIds.add(s.parentClusterId);
        }
      }
      for (const obsId of this.params.obsoleteClusterIdsToDelete ?? []) {
        priorParentClusterIds.add(obsId);
      }

      const priorClusters = this.repo.getByIds([...priorParentClusterIds]);
      const snapshotMap = new Map<NodeId, SpatialNodeRecord>();
      if (existingCluster) {
        snapshotMap.set(existingCluster.id, existingCluster);
      }
      for (const c of priorClusters) snapshotMap.set(c.id, c);
      for (const s of strokes) snapshotMap.set(s.id, s);
      this.beforeSnapshots = [...snapshotMap.values()];

      if (existingCluster) {
        this.repo.updateClusterBoundsAndTags(
          this.params.clusterId,
          this.params.bbox,
          this.params.memberStrokeIds.length,
          this.params.semanticTags
        );
      } else {
        this.repo.insertNode({
          id: this.params.clusterId,
          canvasId: this.params.canvasId,
          layerId: this.params.layerId,
          nodeType: 'stroke_cluster',
          parentClusterId: null,
          bbox: this.params.bbox,
          strokePoints: null,
          style: null,
          contentJson: this.params.contentJson,
          ocrText: null,
          semanticTags: this.params.semanticTags,
        });
      }

      this.repo.assignNodesToCluster(
        this.params.memberStrokeIds,
        this.params.clusterId
      );

      const obsoleteIds = this.params.obsoleteClusterIdsToDelete ?? [];
      if (obsoleteIds.length > 0) {
        this.repo.deleteByIds(obsoleteIds);
      }

      const remainingPriorClusters = [...priorParentClusterIds].filter(
        (id) => !obsoleteIds.includes(id)
      );
      if (remainingPriorClusters.length > 0) {
        this.repo.pruneOrUpdateParentClusters(remainingPriorClusters);
      }
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      if (this.beforeSnapshots.length > 0) {
        this.repo.restoreSnapshots(this.beforeSnapshots);
      }
      if (this.createdNewCluster) {
        this.repo.deleteByIds([this.params.clusterId]);
      }
    });
  }
}

export class MoveNodesCommand implements CanvasCommand {
  public readonly kind = 'MOVE_NODES';
  public readonly affectedNodeIds: readonly NodeId[];
  private beforeSnapshots: SpatialNodeRecord[] = [];

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly repo: SpatialNodeRepository,
    targetNodeIds: readonly NodeId[],
    private readonly dx: number,
    private readonly dy: number
  ) {
    this.affectedNodeIds = [...targetNodeIds];
  }

  public execute(): void {
    this.db.transaction(() => {
      const direct = this.repo.getByIds(this.affectedNodeIds);
      const children = this.repo.getChildStrokesOfClusters(this.affectedNodeIds);
      const map = new Map<NodeId, SpatialNodeRecord>();
      for (const n of direct) map.set(n.id, n);
      for (const c of children) map.set(c.id, c);
      this.beforeSnapshots = [...map.values()];

      this.repo.translateBatch(this.affectedNodeIds, this.dx, this.dy);
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      this.repo.restoreSnapshots(this.beforeSnapshots);
    });
  }
}

export class EraseNodesCommand implements CanvasCommand {
  public readonly kind = 'ERASE_NODES';
  public readonly affectedNodeIds: readonly NodeId[];
  private deletedSnapshots: SpatialNodeRecord[] = [];
  private parentClusterSnapshots: SpatialNodeRecord[] = [];
  private siblingStrokeSnapshots: SpatialNodeRecord[] = [];
  private splitClusterIdsCreated: NodeId[] = [];

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly repo: SpatialNodeRepository,
    targetNodeIds: readonly NodeId[]
  ) {
    this.affectedNodeIds = [...targetNodeIds];
  }

  public execute(): void {
    this.db.transaction(() => {
      const direct = this.repo.getByIds(this.affectedNodeIds);
      const children = this.repo.getChildStrokesOfClusters(this.affectedNodeIds);
      const map = new Map<NodeId, SpatialNodeRecord>();
      for (const n of direct) map.set(n.id, n);
      for (const c of children) map.set(c.id, c);
      this.deletedSnapshots = [...map.values()];

      const parentClusterIds = new Set<NodeId>();
      for (const s of this.deletedSnapshots) {
        if (s.parentClusterId && !map.has(s.parentClusterId)) {
          parentClusterIds.add(s.parentClusterId);
        }
      }
      this.parentClusterSnapshots = this.repo.getByIds([...parentClusterIds]);
      this.siblingStrokeSnapshots =
        parentClusterIds.size > 0
          ? this.repo
              .getChildStrokesOfClusters([...parentClusterIds])
              .filter((c) => !map.has(c.id))
          : [];

      this.repo.deleteByIds(this.deletedSnapshots.map((s) => s.id));
      if (parentClusterIds.size > 0) {
        this.splitClusterIdsCreated = this.repo.pruneOrUpdateParentClusters([
          ...parentClusterIds,
        ]);
      } else {
        this.splitClusterIdsCreated = [];
      }
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      if (this.splitClusterIdsCreated.length > 0) {
        this.repo.deleteByIds(this.splitClusterIdsCreated);
        this.splitClusterIdsCreated = [];
      }
      this.repo.restoreSnapshots([
        ...this.parentClusterSnapshots,
        ...this.siblingStrokeSnapshots,
        ...this.deletedSnapshots,
      ]);
    });
  }
}

export interface CommandHistoryOptions {
  readonly onCancelJobsForNodes?: (nodeIds: readonly NodeId[]) => void;
  readonly onRedoCommand?: (command: CanvasCommand) => void;
}

export class CommandHistory {
  private readonly undoStack: CanvasCommand[] = [];
  private readonly redoStack: CanvasCommand[] = [];
  private readonly onCancelJobsForNodes?: (nodeIds: readonly NodeId[]) => void;
  private readonly onRedoCommand?: (command: CanvasCommand) => void;

  public constructor(options: CommandHistoryOptions = {}) {
    this.onCancelJobsForNodes = options.onCancelJobsForNodes;
    this.onRedoCommand = options.onRedoCommand;
  }

  public execute(command: CanvasCommand): void {
    command.execute();
    if (command.didMutate === false) {
      return;
    }

    if (
      (command.kind === 'ERASE_NODES' || command.kind === 'SLICE_ERASE') &&
      this.onCancelJobsForNodes
    ) {
      this.onCancelJobsForNodes(command.affectedNodeIds);
    }

    const top = this.undoStack[this.undoStack.length - 1];
    if (top?.tryMergeWith && top.tryMergeWith(command)) {
      this.redoStack.length = 0;
      return;
    }

    this.undoStack.push(command);
    this.redoStack.length = 0;
  }

  public undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;

    command.undo();
    this.redoStack.push(command);

    if (this.onCancelJobsForNodes && command.affectedNodeIds.length > 0) {
      this.onCancelJobsForNodes(command.affectedNodeIds);
    }
    return true;
  }

  public redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;

    command.execute();
    this.undoStack.push(command);
    if (this.onRedoCommand) {
      this.onRedoCommand(command);
    }
    return true;
  }

  public get undoDepth(): number {
    return this.undoStack.length;
  }

  public get redoDepth(): number {
    return this.redoStack.length;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
