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
  execute(): void;
  undo(): void;
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
  public readonly affectedNodeIds: readonly NodeId[];
  private readonly createdTimestamp: number;

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly repo: SpatialNodeRepository,
    private readonly params: CommitStrokeParams
  ) {
    this.affectedNodeIds = [params.id];
    this.createdTimestamp = params.createdAt ?? Date.now();
  }

  public execute(): void {
    this.db.transaction(() => {
      this.repo.insertNode({
        id: this.params.id,
        canvasId: this.params.canvasId,
        layerId: this.params.layerId,
        nodeType: 'vector_stroke',
        parentClusterId: null,
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
      this.repo.deleteByIds([this.params.id]);
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

      this.repo.deleteByIds(this.deletedSnapshots.map((s) => s.id));
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      this.repo.restoreSnapshots(this.deletedSnapshots);
    });
  }
}

export interface CommandHistoryOptions {
  readonly onCancelJobsForNodes?: (nodeIds: readonly NodeId[]) => void;
}

export class CommandHistory {
  private readonly undoStack: CanvasCommand[] = [];
  private readonly redoStack: CanvasCommand[] = [];
  private readonly onCancelJobsForNodes?: (nodeIds: readonly NodeId[]) => void;

  public constructor(options: CommandHistoryOptions = {}) {
    this.onCancelJobsForNodes = options.onCancelJobsForNodes;
  }

  public execute(command: CanvasCommand): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack.length = 0;

    if (command.kind === 'ERASE_NODES' && this.onCancelJobsForNodes) {
      this.onCancelJobsForNodes(command.affectedNodeIds);
    }
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
    return true;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
