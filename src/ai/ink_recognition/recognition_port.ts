import { z } from 'zod';
import type { NodeId, WorldAABB } from '../../core/canvas/types.js';
import type { SpatialNodeRecord } from '../../db/repositories/spatial_node_repository.js';
import {
  BlockModalitySchema,
  KeywordMarkerTypeSchema,
  type BlockModality,
  type KeywordMarkerType,
} from '../../db/repositories/zettel_repository.js';

export const SpatialGestureTypeSchema = z.enum([
  'enclosure_loop',
  'underline',
  'double_underline',
  'pointing_arrow',
  'curly_brace_group',
]);

export type SpatialGestureType = z.infer<typeof SpatialGestureTypeSchema>;

export const PromotedKeywordCandidateSchema = z.object({
  keywordText: z.string().min(1),
  normalizedKeyword: z.string().min(1),
  markerType: KeywordMarkerTypeSchema,
  gestureStrokeId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type PromotedKeywordCandidate = z.infer<
  typeof PromotedKeywordCandidateSchema
>;

export const ExtractedSigilsSchema = z.object({
  hashTags: z.array(z.string()),
  bangAxioms: z.array(z.string()),
  questionInquiries: z.array(z.string()),
  atEntities: z.array(z.string()),
  dueDatesIso: z.array(z.string()),
  checkboxState: z.enum(['none', 'todo', 'done']),
  cleanText: z.string(),
});

export type ExtractedSigils = z.infer<typeof ExtractedSigilsSchema>;

export interface ClusterAnalysisResult {
  readonly clusterId: NodeId;
  readonly modality: BlockModality;
  readonly rawText: string;
  readonly normalizedTokens: readonly string[];
  readonly structuralMetadata: Record<string, unknown>;
  readonly promotedKeywords: readonly PromotedKeywordCandidate[];
  readonly sigils: ExtractedSigils;
  readonly bbox: WorldAABB;
}

export interface PointingArrowDetection {
  readonly strokeId: NodeId;
  readonly tailX: number;
  readonly tailY: number;
  readonly tipX: number;
  readonly tipY: number;
  readonly confidence: number;
}

export interface InkRecognitionPort {
  analyzeCluster(
    cluster: SpatialNodeRecord,
    memberStrokes: readonly SpatialNodeRecord[]
  ): ClusterAnalysisResult;
  detectPointingArrow(
    stroke: SpatialNodeRecord
  ): PointingArrowDetection | null;
}

export { BlockModalitySchema, KeywordMarkerTypeSchema };
export type { BlockModality, KeywordMarkerType };
