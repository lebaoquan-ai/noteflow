import { z } from 'zod';
import {
  nodeId,
  type Brand,
  type NodeId,
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
}
