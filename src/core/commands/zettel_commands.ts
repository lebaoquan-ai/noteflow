import {
  nodeId,
  worldAABB,
  type CanvasId,
  type LayerId,
  type NodeId,
} from '../canvas/types.js';
import type { CreateZettelCardToolInput } from '../../ai/agent_contract.js';
import type { NoteFlowDatabase } from '../../db/client.js';
import type { SpatialNodeRepository } from '../../db/repositories/spatial_node_repository.js';
import {
  zettelId,
  type ZettelId,
  type ZettelRelationType,
  type ZettelRepository,
} from '../../db/repositories/zettel_repository.js';
import type { CanvasCommand } from './canvas_command.js';

export const DEFAULT_ZETTEL_CARD_WIDTH = 260;
export const DEFAULT_ZETTEL_CARD_HEIGHT = 140;

export interface CreateZettelCardParams {
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly toolInput: CreateZettelCardToolInput;
  readonly embedding: Float32Array | null;
  readonly zettelId?: ZettelId;
  readonly spatialNodeId?: NodeId;
}

export class CreateZettelCardCommand implements CanvasCommand {
  public readonly kind = 'CREATE_ZETTEL_CARD';
  public readonly zettelId: ZettelId;
  public readonly spatialNodeId: NodeId;
  public readonly affectedNodeIds: readonly NodeId[];
  private readonly timestamp: number;

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly nodeRepo: SpatialNodeRepository,
    private readonly zettelRepo: ZettelRepository,
    private readonly params: CreateZettelCardParams
  ) {
    this.zettelId = params.zettelId ?? zettelId(crypto.randomUUID());
    this.spatialNodeId = params.spatialNodeId ?? nodeId(crypto.randomUUID());
    this.affectedNodeIds = [this.spatialNodeId];
    this.timestamp = Date.now();
  }

  public execute(): void {
    const { x, y } = this.params.toolInput.worldPosition;
    const bbox = worldAABB(
      x,
      y,
      x + DEFAULT_ZETTEL_CARD_WIDTH,
      y + DEFAULT_ZETTEL_CARD_HEIGHT
    );

    this.db.transaction(() => {
      this.nodeRepo.insertNode({
        id: this.spatialNodeId,
        canvasId: this.params.canvasId,
        layerId: this.params.layerId,
        nodeType: 'zettel_card',
        parentClusterId: nodeId(this.params.toolInput.anchorClusterId),
        bbox,
        strokePoints: null,
        style: null,
        contentJson: {
          zettelId: this.zettelId,
          title: this.params.toolInput.title,
          summaryMarkdown: this.params.toolInput.summaryMarkdown,
          latexBlocks: this.params.toolInput.latexBlocks,
          verificationState: this.params.toolInput.verificationState,
        },
        ocrText: this.params.toolInput.summaryMarkdown,
        semanticTags: ['zettel', this.params.toolInput.verificationState],
        createdAt: this.timestamp,
        updatedAt: this.timestamp,
      });

      this.zettelRepo.insertZettel({
        id: this.zettelId,
        spatialNodeId: this.spatialNodeId,
        title: this.params.toolInput.title,
        summaryMarkdown: this.params.toolInput.summaryMarkdown,
        latexBlocks: this.params.toolInput.latexBlocks,
        verificationState: this.params.toolInput.verificationState,
        embedding: this.params.embedding,
        createdAt: this.timestamp,
        updatedAt: this.timestamp,
      });
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      this.zettelRepo.deleteById(this.zettelId);
      this.nodeRepo.deleteByIds([this.spatialNodeId]);
    });
  }
}

export interface LinkZettelsParams {
  readonly linkId?: string;
  readonly sourceZettelId: ZettelId;
  readonly targetZettelId: ZettelId;
  readonly relationType: ZettelRelationType;
  readonly confidence?: number;
}

/**
 * Phase 3 Knowledge Graph Edge Command (`docs/SPEC.md` §5.3 & §7):
 * Atomically links two Zettels in `zettel_links` (or accepts a Ghost Link)
 * and removes the link on undo.
 */
export class LinkZettelsCommand implements CanvasCommand {
  public readonly kind = 'LINK_ZETTELS';
  public readonly linkId: string;
  public readonly affectedNodeIds: readonly NodeId[];

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly zettelRepo: ZettelRepository,
    private readonly params: LinkZettelsParams
  ) {
    this.linkId = params.linkId ?? crypto.randomUUID();
    const src = this.zettelRepo.getById(params.sourceZettelId);
    const dst = this.zettelRepo.getById(params.targetZettelId);
    const ids: NodeId[] = [];
    if (src?.spatialNodeId) ids.push(src.spatialNodeId);
    if (dst?.spatialNodeId) ids.push(dst.spatialNodeId);
    this.affectedNodeIds = ids;
  }

  public execute(): void {
    this.db.transaction(() => {
      this.zettelRepo.upsertLink({
        id: this.linkId,
        sourceZettelId: this.params.sourceZettelId,
        targetZettelId: this.params.targetZettelId,
        relationType: this.params.relationType,
        confidence: this.params.confidence ?? 1.0,
      });
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      this.zettelRepo.deleteLinkById(this.linkId);
    });
  }
}
