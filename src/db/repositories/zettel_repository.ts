import { z } from 'zod';
import {
  canvasId,
  layerId,
  nodeId,
  worldAABB,
  type Brand,
  type CanvasId,
  type LayerId,
  type NodeId,
  type WorldAABB,
} from '../../core/canvas/types.js';
import type { NoteFlowDatabase } from '../client.js';

export type ZettelId = Brand<string, 'ZettelId'>;
export function zettelId(id: string): ZettelId {
  return id as ZettelId;
}

export const VerificationStateSchema = z.enum([
  'unverified',
  'verified',
  'conflict',
  'hint',
]);

export type VerificationState = z.infer<typeof VerificationStateSchema>;

export const ZettelRelationTypeSchema = z.enum([
  'supports',
  'contradicts',
  'derives_from',
  'related',
]);

export type ZettelRelationType = z.infer<typeof ZettelRelationTypeSchema>;

export const BlockModalitySchema = z.enum([
  'prose_explanation',
  'sketch_diagram',
  'comparison_table',
  'math_expression',
  'ordered_list',
]);

export type BlockModality = z.infer<typeof BlockModalitySchema>;

export const KeywordMarkerTypeSchema = z.enum([
  'circle',
  'underline',
  'double_underline',
  'hash_tag',
  'bang_axiom',
  'question_inquiry',
  'at_entity',
]);

export type KeywordMarkerType = z.infer<typeof KeywordMarkerTypeSchema>;

export const EvidenceRelationTypeSchema = z.enum([
  'inline_context',
  'pointing_arrow_support',
  'curly_brace_elaboration',
  'section_flow',
]);

export type EvidenceRelationType = z.infer<typeof EvidenceRelationTypeSchema>;

export const SpatialRelationTypeSchema = z.enum([
  'pointing_arrow',
  'curly_brace_group',
]);

export type SpatialRelationType = z.infer<typeof SpatialRelationTypeSchema>;

const RawZettelRowSchema = z.object({
  id: z.string().uuid(),
  spatial_node_id: z.string().uuid().nullable(),
  title: z.string(),
  summary_markdown: z.string(),
  latex_blocks_json: z.string().nullable(),
  verification_state: VerificationStateSchema,
  embedding: z.instanceof(Uint8Array).nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

const RawZettelLinkRowSchema = z.object({
  id: z.string().uuid(),
  source_zettel_id: z.string().uuid(),
  target_zettel_id: z.string().uuid(),
  relation_type: ZettelRelationTypeSchema,
  confidence: z.number().finite(),
});

const RawCanvasBlockRowSchema = z.object({
  id: z.string(),
  canvas_id: z.string(),
  spatial_node_id: z.string(),
  modality: BlockModalitySchema,
  raw_text: z.string(),
  structured_json: z.string().nullable(),
  min_x: z.number().finite(),
  min_y: z.number().finite(),
  max_x: z.number().finite(),
  max_y: z.number().finite(),
  updated_at: z.number().int(),
});

const RawZettelKeywordRowSchema = z.object({
  id: z.string(),
  canvas_id: z.string(),
  zettel_id: z.string(),
  source_block_id: z.string(),
  keyword_text: z.string(),
  normalized_keyword: z.string(),
  marker_type: KeywordMarkerTypeSchema,
  is_primary_concept: z.number().int(),
  created_at: z.number().int(),
});

const RawZettelEvidenceLinkRowSchema = z.object({
  id: z.string(),
  zettel_id: z.string(),
  block_id: z.string(),
  evidence_role: EvidenceRelationTypeSchema,
  confidence: z.number().finite(),
  created_at: z.number().int(),
});

const RawSpatialRelationRowSchema = z.object({
  id: z.string(),
  canvas_id: z.string(),
  connector_stroke_id: z.string(),
  source_node_id: z.string(),
  target_node_id: z.string(),
  relation_type: SpatialRelationTypeSchema,
  created_at: z.number().int(),
});

const RawAgendaTaskRowSchema = z.object({
  id: z.string(),
  canvas_id: z.string(),
  source_node_id: z.string(),
  task_text: z.string(),
  due_date_iso: z.string().nullable(),
  status: z.enum(['todo', 'done']),
  created_at: z.number().int(),
});

export interface ZettelRecord {
  readonly id: ZettelId;
  readonly spatialNodeId: NodeId | null;
  readonly title: string;
  readonly summaryMarkdown: string;
  readonly latexBlocks: string[];
  readonly verificationState: VerificationState;
  readonly embedding: Float32Array | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ZettelLinkRecord {
  readonly id: string;
  readonly sourceZettelId: ZettelId;
  readonly targetZettelId: ZettelId;
  readonly relationType: ZettelRelationType;
  readonly confidence: number;
}

export interface CanvasBlockRecord {
  readonly id: string;
  readonly canvasId: CanvasId;
  readonly layerId: LayerId;
  readonly spatialNodeId: NodeId;
  readonly modality: BlockModality;
  readonly rawText: string;
  readonly normalizedTokens: readonly string[];
  readonly structuralMetadata: Record<string, unknown> | null;
  readonly bbox: WorldAABB;
  readonly updatedAt: number;
}

export interface ZettelKeywordRecord {
  readonly id: string;
  readonly zettelId: ZettelId;
  readonly canvasBlockId: string;
  readonly keywordText: string;
  readonly normalizedKeyword: string;
  readonly markerType: KeywordMarkerType;
  readonly isPrimaryConcept: boolean;
  readonly gestureStrokeId: NodeId | null;
  readonly confidence: number;
  readonly createdAt: number;
}

export interface ZettelEvidenceLinkRecord {
  readonly id: string;
  readonly zettelId: ZettelId;
  readonly canvasBlockId: string;
  readonly blockId: string;
  readonly relationType: EvidenceRelationType;
  readonly evidenceRole: EvidenceRelationType;
  readonly connectorStrokeId: NodeId | null;
  readonly weight: number;
}

export interface SpatialRelationRecord {
  readonly id: string;
  readonly canvasId: CanvasId;
  readonly connectorStrokeId: NodeId;
  readonly sourceClusterId: NodeId;
  readonly targetClusterId: NodeId;
  readonly relationType: SpatialRelationType;
  readonly confidence: number;
  readonly createdAt: number;
}

export interface AgendaTaskRecord {
  readonly id: string;
  readonly canvasId: CanvasId;
  readonly spatialNodeId: NodeId;
  readonly taskText: string;
  readonly dueDateIso: string | null;
  readonly completed: boolean;
  readonly updatedAt: number;
}

function float32ToBlob(vec: Float32Array | null): Uint8Array | null {
  if (!vec) return null;
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

function blobToFloat32(blob: Uint8Array | null): Float32Array | null {
  if (!blob) return null;
  const aligned = new Uint8Array(blob.byteLength);
  aligned.set(blob);
  return new Float32Array(aligned.buffer);
}

function parseZettelRow(raw: unknown): ZettelRecord {
  const row = RawZettelRowSchema.parse(raw);
  const latexBlocks = row.latex_blocks_json
    ? z.array(z.string()).parse(JSON.parse(row.latex_blocks_json))
    : [];

  return {
    id: zettelId(row.id),
    spatialNodeId: row.spatial_node_id ? nodeId(row.spatial_node_id) : null,
    title: row.title,
    summaryMarkdown: row.summary_markdown,
    latexBlocks,
    verificationState: row.verification_state,
    embedding: blobToFloat32(row.embedding),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseZettelLinkRow(raw: unknown): ZettelLinkRecord {
  const row = RawZettelLinkRowSchema.parse(raw);
  return {
    id: row.id,
    sourceZettelId: zettelId(row.source_zettel_id),
    targetZettelId: zettelId(row.target_zettel_id),
    relationType: row.relation_type,
    confidence: row.confidence,
  };
}

function parseCanvasBlockRow(raw: unknown): CanvasBlockRecord {
  const row = RawCanvasBlockRowSchema.parse(raw);
  const parsedJson = row.structured_json
    ? (JSON.parse(row.structured_json) as Record<string, unknown>)
    : null;
  const normalizedTokens = Array.isArray(parsedJson?.normalizedTokens)
    ? (parsedJson.normalizedTokens as string[])
    : [];
  const lId =
    typeof parsedJson?.layerId === 'string'
      ? layerId(parsedJson.layerId)
      : layerId(row.canvas_id);
  return {
    id: row.id,
    canvasId: canvasId(row.canvas_id),
    layerId: lId,
    spatialNodeId: nodeId(row.spatial_node_id),
    modality: row.modality,
    rawText: row.raw_text,
    normalizedTokens,
    structuralMetadata: parsedJson,
    bbox: worldAABB(row.min_x, row.min_y, row.max_x, row.max_y),
    updatedAt: row.updated_at,
  };
}

function parseZettelKeywordRow(raw: unknown): ZettelKeywordRecord {
  const row = RawZettelKeywordRowSchema.parse(raw);
  return {
    id: row.id,
    zettelId: zettelId(row.zettel_id),
    canvasBlockId: row.source_block_id,
    keywordText: row.keyword_text,
    normalizedKeyword: row.normalized_keyword,
    markerType: row.marker_type,
    isPrimaryConcept: row.is_primary_concept !== 0,
    gestureStrokeId: null,
    confidence: 1.0,
    createdAt: row.created_at,
  };
}

function parseZettelEvidenceLinkRow(raw: unknown): ZettelEvidenceLinkRecord {
  const row = RawZettelEvidenceLinkRowSchema.parse(raw);
  return {
    id: row.id,
    zettelId: zettelId(row.zettel_id),
    canvasBlockId: row.block_id,
    blockId: row.block_id,
    relationType: row.evidence_role,
    evidenceRole: row.evidence_role,
    connectorStrokeId: null,
    weight: row.confidence,
  };
}

function parseSpatialRelationRow(raw: unknown): SpatialRelationRecord {
  const row = RawSpatialRelationRowSchema.parse(raw);
  return {
    id: row.id,
    canvasId: canvasId(row.canvas_id),
    connectorStrokeId: nodeId(row.connector_stroke_id),
    sourceClusterId: nodeId(row.source_node_id),
    targetClusterId: nodeId(row.target_node_id),
    relationType: row.relation_type,
    confidence: 1.0,
    createdAt: row.created_at,
  };
}

function parseAgendaTaskRow(raw: unknown): AgendaTaskRecord {
  const row = RawAgendaTaskRowSchema.parse(raw);
  return {
    id: row.id,
    canvasId: canvasId(row.canvas_id),
    spatialNodeId: nodeId(row.source_node_id),
    taskText: row.task_text,
    dueDateIso: row.due_date_iso,
    completed: row.status === 'done',
    updatedAt: row.created_at,
  };
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-12 ? dot / denom : 0;
}

export class ZettelRepository {
  public constructor(private readonly db: NoteFlowDatabase) {}

  public insertZettel(params: {
    id: ZettelId;
    spatialNodeId: NodeId | null;
    title: string;
    summaryMarkdown: string;
    latexBlocks: readonly string[];
    verificationState: VerificationState;
    embedding: Float32Array | null;
    createdAt?: number;
    updatedAt?: number;
  }): ZettelRecord {
    const now = Date.now();
    const createdAt = params.createdAt ?? now;
    const updatedAt = params.updatedAt ?? now;

    this.db.raw
      .prepare(
        `INSERT OR REPLACE INTO zettels (
          id, spatial_node_id, title, summary_markdown, latex_blocks_json,
          verification_state, embedding, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.id,
        params.spatialNodeId,
        params.title,
        params.summaryMarkdown,
        JSON.stringify(params.latexBlocks),
        params.verificationState,
        float32ToBlob(params.embedding),
        createdAt,
        updatedAt
      );

    return this.getById(params.id)!;
  }

  public getById(id: ZettelId): ZettelRecord | null {
    const row = this.db.raw
      .prepare(`SELECT * FROM zettels WHERE id = ?`)
      .get(id);
    if (!row) return null;
    return parseZettelRow(row);
  }

  public deleteById(id: ZettelId): void {
    this.db.raw.prepare(`DELETE FROM zettels WHERE id = ?`).run(id);
  }

  public getAllZettels(): ZettelRecord[] {
    const rows = this.db.raw
      .prepare(`SELECT * FROM zettels ORDER BY created_at ASC`)
      .all();
    return rows.map(parseZettelRow);
  }

  public getAllLinks(): ZettelLinkRecord[] {
    const rows = this.db.raw.prepare(`SELECT * FROM zettel_links`).all();
    return rows.map(parseZettelLinkRow);
  }

  public deleteLinkById(linkId: string): void {
    this.db.raw
      .prepare(`DELETE FROM zettel_links WHERE id = ?`)
      .run(linkId);
  }

  public upsertLink(params: {
    id?: string;
    sourceZettelId: ZettelId;
    targetZettelId: ZettelId;
    relationType: ZettelRelationType;
    confidence?: number;
  }): ZettelLinkRecord {
    const linkId = params.id ?? crypto.randomUUID();
    const confidence = params.confidence ?? 1.0;

    this.db.raw
      .prepare(
        `INSERT INTO zettel_links (
          id, source_zettel_id, target_zettel_id, relation_type, confidence
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_zettel_id, target_zettel_id, relation_type)
        DO UPDATE SET confidence = excluded.confidence`
      )
      .run(
        linkId,
        params.sourceZettelId,
        params.targetZettelId,
        params.relationType,
        confidence
      );

    const row = this.db.raw
      .prepare(
        `SELECT * FROM zettel_links
         WHERE source_zettel_id = ? AND target_zettel_id = ? AND relation_type = ?`
      )
      .get(params.sourceZettelId, params.targetZettelId, params.relationType);

    return parseZettelLinkRow(row);
  }

  public getLinksForZettel(targetZettelId: ZettelId): ZettelLinkRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM zettel_links
         WHERE source_zettel_id = ? OR target_zettel_id = ?`
      )
      .all(targetZettelId, targetZettelId);
    return rows.map(parseZettelLinkRow);
  }

  /**
   * Semantic Vector Similarity Search over 768-dim Float32Array embeddings.
   */
  public searchSimilarZettels(
    queryEmbedding: Float32Array,
    topK: number = 5
  ): Array<{ zettel: ZettelRecord; similarity: number }> {
    const rows = this.db.raw
      .prepare(`SELECT * FROM zettels WHERE embedding IS NOT NULL`)
      .all();
    const zettels = rows.map(parseZettelRow);

    const scored = zettels
      .filter((z) => z.embedding !== null)
      .map((z) => ({
        zettel: z,
        similarity: cosineSimilarity(queryEmbedding, z.embedding!),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topK);
  }

  /**
   * Phase 3 Ghost Link Discovery (`docs/SPEC.md` §5.3 & §7):
   * Finds semantically similar Zettels (cosine similarity >= minSimilarity) that
   * do not yet have an explicit edge in `zettel_links`.
   */
  public discoverGhostLinks(
    sourceId: ZettelId,
    minSimilarity: number = 0.72
  ): Array<{ targetZettel: ZettelRecord; similarity: number }> {
    const source = this.getById(sourceId);
    if (!source || !source.embedding) return [];

    const existingLinks = this.getLinksForZettel(sourceId);
    const alreadyLinkedIds = new Set<string>([sourceId]);
    for (const link of existingLinks) {
      alreadyLinkedIds.add(link.sourceZettelId);
      alreadyLinkedIds.add(link.targetZettelId);
    }

    const candidates = this.searchSimilarZettels(source.embedding, 10);
    return candidates
      .filter(
        (c) =>
          !alreadyLinkedIds.has(c.zettel.id) && c.similarity >= minSimilarity
      )
      .map((c) => ({
        targetZettel: c.zettel,
        similarity: c.similarity,
      }));
  }

  public updateZettel(params: {
    id: ZettelId;
    spatialNodeId: NodeId | null;
    title: string;
    summaryMarkdown: string;
    latexBlocks?: readonly string[];
    verificationState: VerificationState;
  }): ZettelRecord {
    const existing = this.getById(params.id);
    if (!existing) {
      return this.insertZettel({
        id: params.id,
        spatialNodeId: params.spatialNodeId,
        title: params.title,
        summaryMarkdown: params.summaryMarkdown,
        latexBlocks: params.latexBlocks ?? [],
        verificationState: params.verificationState,
        embedding: null,
      });
    }
    const now = Date.now();
    this.db.raw
      .prepare(
        `UPDATE zettels SET spatial_node_id = ?, title = ?, summary_markdown = ?, verification_state = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        params.spatialNodeId,
        params.title,
        params.summaryMarkdown,
        params.verificationState,
        now,
        params.id
      );
    return this.getById(params.id)!;
  }

  public upsertCanvasBlock(block: CanvasBlockRecord): CanvasBlockRecord {
    const structuredPayload = {
      ...(block.structuralMetadata ?? {}),
      layerId: block.layerId,
      normalizedTokens: block.normalizedTokens,
    };
    this.db.raw
      .prepare(
        `INSERT OR REPLACE INTO canvas_blocks (
          id, canvas_id, spatial_node_id, modality, raw_text,
          structured_json, min_x, min_y, max_x, max_y, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        block.id,
        block.canvasId,
        block.spatialNodeId,
        block.modality,
        block.rawText,
        JSON.stringify(structuredPayload),
        block.bbox[0],
        block.bbox[1],
        block.bbox[2],
        block.bbox[3],
        block.updatedAt
      );
    return this.getCanvasBlockByNodeId(block.spatialNodeId)!;
  }

  public deleteCanvasBlock(id: string): void {
    this.db.raw.prepare(`DELETE FROM canvas_blocks WHERE id = ?`).run(id);
  }

  public getCanvasBlocks(targetCanvasId: CanvasId): CanvasBlockRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM canvas_blocks WHERE canvas_id = ? ORDER BY min_y ASC, min_x ASC`
      )
      .all(targetCanvasId);
    return rows.map(parseCanvasBlockRow);
  }

  public getCanvasBlockByNodeId(
    spatialNodeId: NodeId
  ): CanvasBlockRecord | null {
    const row = this.db.raw
      .prepare(`SELECT * FROM canvas_blocks WHERE spatial_node_id = ?`)
      .get(spatialNodeId);
    if (!row) return null;
    return parseCanvasBlockRow(row);
  }

  public searchCanvasBlocks(
    targetCanvasId: CanvasId,
    query: string
  ): CanvasBlockRecord[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.getCanvasBlocks(targetCanvasId);
    return this.getCanvasBlocks(targetCanvasId).filter(
      (b) =>
        b.rawText.toLowerCase().includes(q) ||
        b.normalizedTokens.some((tok) => tok.includes(q)) ||
        b.modality.toLowerCase().includes(q)
    );
  }

  public replaceZettelKeywordsForCanvas(
    targetCanvasId: CanvasId,
    keywords: readonly ZettelKeywordRecord[]
  ): void {
    this.db.raw
      .prepare(`DELETE FROM zettel_keywords WHERE canvas_id = ?`)
      .run(targetCanvasId);
    const stmt = this.db.raw.prepare(
      `INSERT OR REPLACE INTO zettel_keywords (
        id, canvas_id, zettel_id, source_block_id, keyword_text,
        normalized_keyword, marker_type, is_primary_concept, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const kw of keywords) {
      stmt.run(
        kw.id,
        targetCanvasId,
        kw.zettelId,
        kw.canvasBlockId,
        kw.keywordText,
        kw.normalizedKeyword,
        kw.markerType,
        kw.isPrimaryConcept ? 1 : 0,
        kw.createdAt
      );
    }
  }

  public getZettelKeywords(targetCanvasId: CanvasId): ZettelKeywordRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM zettel_keywords WHERE canvas_id = ? ORDER BY created_at ASC`
      )
      .all(targetCanvasId);
    return rows.map(parseZettelKeywordRow);
  }

  public replaceEvidenceLinksForZettel(
    targetZettelId: ZettelId,
    links: readonly ZettelEvidenceLinkRecord[]
  ): void {
    this.db.raw
      .prepare(`DELETE FROM zettel_evidence_links WHERE zettel_id = ?`)
      .run(targetZettelId);
    const now = Date.now();
    const stmt = this.db.raw.prepare(
      `INSERT OR REPLACE INTO zettel_evidence_links (
        id, zettel_id, block_id, evidence_role, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const link of links) {
      stmt.run(
        link.id,
        link.zettelId,
        link.canvasBlockId,
        link.relationType,
        link.weight,
        now
      );
    }
  }

  public getEvidenceLinksForZettel(
    targetZettelId: ZettelId
  ): ZettelEvidenceLinkRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM zettel_evidence_links WHERE zettel_id = ? ORDER BY confidence DESC, created_at ASC`
      )
      .all(targetZettelId);
    return rows.map(parseZettelEvidenceLinkRow);
  }

  public replaceSpatialRelationsForCanvas(
    targetCanvasId: CanvasId,
    relations: readonly SpatialRelationRecord[]
  ): void {
    this.db.raw
      .prepare(`DELETE FROM spatial_relations WHERE canvas_id = ?`)
      .run(targetCanvasId);
    const stmt = this.db.raw.prepare(
      `INSERT OR REPLACE INTO spatial_relations (
        id, canvas_id, connector_stroke_id, source_node_id, target_node_id,
        relation_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const rel of relations) {
      stmt.run(
        rel.id,
        rel.canvasId,
        rel.connectorStrokeId,
        rel.sourceClusterId,
        rel.targetClusterId,
        rel.relationType,
        rel.createdAt
      );
    }
  }

  public getSpatialRelations(
    targetCanvasId: CanvasId
  ): SpatialRelationRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM spatial_relations WHERE canvas_id = ? ORDER BY created_at ASC`
      )
      .all(targetCanvasId);
    return rows.map(parseSpatialRelationRow);
  }

  public replaceAgendaTasksForCanvas(
    targetCanvasId: CanvasId,
    tasks: readonly AgendaTaskRecord[]
  ): void {
    this.db.raw
      .prepare(`DELETE FROM agenda_tasks WHERE canvas_id = ?`)
      .run(targetCanvasId);
    const stmt = this.db.raw.prepare(
      `INSERT OR REPLACE INTO agenda_tasks (
        id, canvas_id, source_node_id, task_text, due_date_iso, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const task of tasks) {
      stmt.run(
        task.id,
        task.canvasId,
        task.spatialNodeId,
        task.taskText,
        task.dueDateIso,
        task.completed ? 'done' : 'todo',
        task.updatedAt
      );
    }
  }

  public getAgendaTasks(targetCanvasId: CanvasId): AgendaTaskRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM agenda_tasks WHERE canvas_id = ? ORDER BY created_at ASC`
      )
      .all(targetCanvasId);
    return rows.map(parseAgendaTaskRow);
  }
}
