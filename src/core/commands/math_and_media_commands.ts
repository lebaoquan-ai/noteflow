import { z } from 'zod';
import {
  nodeId,
  type CanvasId,
  type LayerId,
  type NodeId,
  type WorldAABB,
} from '../canvas/types.js';
import type { NoteFlowDatabase } from '../../db/client.js';
import type { SpatialNodeRepository } from '../../db/repositories/spatial_node_repository.js';
import type { CanvasCommand } from './canvas_command.js';

export const MathBlockContentSchema = z.object({
  anchorClusterId: z.string().uuid(),
  latex: z.string().min(1),
  displayMode: z.enum(['handwritten', 'typeset']),
});

export type MathBlockContent = z.infer<typeof MathBlockContentSchema>;

export const PdfCitationContentSchema = z.object({
  sourcePdfUri: z.string().min(1),
  pageNumber: z.number().int().min(1),
  sourceRect: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  excerptText: z.string(),
});

export type PdfCitationContent = z.infer<typeof PdfCitationContentSchema>;

export interface CompileMathBlockParams {
  readonly canvasId: CanvasId;
  readonly mathLayerId: LayerId;
  readonly anchorClusterId: NodeId;
  readonly bbox: WorldAABB;
  readonly latex: string;
  readonly mathNodeId?: NodeId;
}

export class CompileMathBlockCommand implements CanvasCommand {
  public readonly kind = 'COMPILE_MATH_BLOCK';
  public readonly mathNodeId: NodeId;
  public readonly affectedNodeIds: readonly NodeId[];
  private readonly timestamp: number;

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly nodeRepo: SpatialNodeRepository,
    private readonly params: CompileMathBlockParams
  ) {
    this.mathNodeId = params.mathNodeId ?? nodeId(crypto.randomUUID());
    this.affectedNodeIds = [this.mathNodeId];
    this.timestamp = Date.now();
  }

  public execute(): void {
    const validatedContent = MathBlockContentSchema.parse({
      anchorClusterId: this.params.anchorClusterId,
      latex: this.params.latex,
      displayMode: 'typeset',
    });

    this.db.transaction(() => {
      this.nodeRepo.insertNode({
        id: this.mathNodeId,
        canvasId: this.params.canvasId,
        layerId: this.params.mathLayerId,
        nodeType: 'math_block',
        parentClusterId: this.params.anchorClusterId,
        bbox: this.params.bbox,
        strokePoints: null,
        style: null,
        contentJson: validatedContent,
        ocrText: this.params.latex,
        semanticTags: ['latex', 'math_formal'],
        createdAt: this.timestamp,
        updatedAt: this.timestamp,
      });
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      this.nodeRepo.deleteByIds([this.mathNodeId]);
    });
  }
}

export interface DragToCiteParams {
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly bbox: WorldAABB;
  readonly citation: PdfCitationContent;
  readonly mediaNodeId?: NodeId;
}

export class DragToCiteCommand implements CanvasCommand {
  public readonly kind = 'DRAG_TO_CITE';
  public readonly mediaNodeId: NodeId;
  public readonly affectedNodeIds: readonly NodeId[];
  private readonly timestamp: number;

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly nodeRepo: SpatialNodeRepository,
    private readonly params: DragToCiteParams
  ) {
    this.mediaNodeId = params.mediaNodeId ?? nodeId(crypto.randomUUID());
    this.affectedNodeIds = [this.mediaNodeId];
    this.timestamp = Date.now();
  }

  public execute(): void {
    const validatedCitation = PdfCitationContentSchema.parse(this.params.citation);

    this.db.transaction(() => {
      this.nodeRepo.insertNode({
        id: this.mediaNodeId,
        canvasId: this.params.canvasId,
        layerId: this.params.layerId,
        nodeType: 'media_item',
        parentClusterId: null,
        bbox: this.params.bbox,
        strokePoints: null,
        style: null,
        contentJson: validatedCitation,
        ocrText: validatedCitation.excerptText,
        semanticTags: ['citation', 'pdf_excerpt'],
        createdAt: this.timestamp,
        updatedAt: this.timestamp,
      });
    });
  }

  public undo(): void {
    this.db.transaction(() => {
      this.nodeRepo.deleteByIds([this.mediaNodeId]);
    });
  }
}
