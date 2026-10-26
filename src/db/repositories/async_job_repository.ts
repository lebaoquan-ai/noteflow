import { z } from 'zod';
import {
  canvasId,
  jobId,
  layerId,
  nodeId,
  type CanvasId,
  type JobId,
  type LayerId,
  type NodeId,
} from '../../core/canvas/types.js';
import type { NoteFlowDatabase } from '../client.js';

export const AsyncJobTypeSchema = z.enum([
  'cluster_ocr',
  'verify_claim',
  'compile_latex',
  'synthesize_zettel',
]);

export type AsyncJobType = z.infer<typeof AsyncJobTypeSchema>;

export const AsyncJobStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
]);

export type AsyncJobStatus = z.infer<typeof AsyncJobStatusSchema>;

const RawAsyncJobWithAnchorRowSchema = z.object({
  id: z.string().uuid(),
  canvas_id: z.string().uuid(),
  anchor_node_id: z.string().uuid(),
  job_type: AsyncJobTypeSchema,
  status: AsyncJobStatusSchema,
  result_json: z.string().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  anchor_x: z.number().finite(),
  anchor_y: z.number().finite(),
  anchor_layer_id: z.string().uuid(),
});

export interface AsyncJobBadgeRecord {
  readonly id: JobId;
  readonly canvasId: CanvasId;
  readonly anchorNodeId: NodeId;
  readonly anchorLayerId: LayerId;
  readonly jobType: AsyncJobType;
  readonly status: AsyncJobStatus;
  readonly resultJson: Record<string, unknown> | null;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

function parseJobWithAnchorRow(raw: unknown): AsyncJobBadgeRecord {
  const row = RawAsyncJobWithAnchorRowSchema.parse(raw);
  const resultJson = row.result_json
    ? z.record(z.string(), z.unknown()).parse(JSON.parse(row.result_json))
    : null;

  return {
    id: jobId(row.id),
    canvasId: canvasId(row.canvas_id),
    anchorNodeId: nodeId(row.anchor_node_id),
    anchorLayerId: layerId(row.anchor_layer_id),
    jobType: row.job_type,
    status: row.status,
    resultJson,
    anchorX: row.anchor_x,
    anchorY: row.anchor_y,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AsyncJobRepository {
  public constructor(private readonly db: NoteFlowDatabase) {}

  public enqueueJob(params: {
    id: JobId;
    canvasId: CanvasId;
    anchorNodeId: NodeId;
    jobType: AsyncJobType;
    createdAt?: number;
  }): AsyncJobBadgeRecord {
    const now = params.createdAt ?? Date.now();
    this.db.raw
      .prepare(
        `INSERT INTO async_jobs (
          id, canvas_id, anchor_node_id, job_type, status, result_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?)`
      )
      .run(
        params.id,
        params.canvasId,
        params.anchorNodeId,
        params.jobType,
        now,
        now
      );

    return this.getBadgeById(params.id)!;
  }

  public updateJobStatus(
    id: JobId,
    status: AsyncJobStatus,
    resultJson: Record<string, unknown> | null = null
  ): AsyncJobBadgeRecord | null {
    const now = Date.now();
    this.db.raw
      .prepare(
        `UPDATE async_jobs
         SET status = ?, result_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        status,
        resultJson ? JSON.stringify(resultJson) : null,
        now,
        id
      );

    return this.getBadgeById(id);
  }

  public getBadgeById(id: JobId): AsyncJobBadgeRecord | null {
    const row = this.db.raw
      .prepare(
        `SELECT j.*, n.max_x AS anchor_x, n.min_y AS anchor_y, n.layer_id AS anchor_layer_id
         FROM async_jobs j
         INNER JOIN spatial_nodes n ON j.anchor_node_id = n.id
         WHERE j.id = ?`
      )
      .get(id);
    if (!row) return null;
    return parseJobWithAnchorRow(row);
  }

  public getBadgesForCanvas(targetCanvasId: CanvasId): AsyncJobBadgeRecord[] {
    const rows = this.db.raw
      .prepare(
        `SELECT j.*, n.max_x AS anchor_x, n.min_y AS anchor_y, n.layer_id AS anchor_layer_id
         FROM async_jobs j
         INNER JOIN spatial_nodes n ON j.anchor_node_id = n.id
         WHERE j.canvas_id = ?
         ORDER BY j.created_at ASC`
      )
      .all(targetCanvasId);
    return rows.map(parseJobWithAnchorRow);
  }

  public getJobsByAnchorNodes(anchorIds: readonly NodeId[]): AsyncJobBadgeRecord[] {
    if (anchorIds.length === 0) return [];
    const placeholders = anchorIds.map(() => '?').join(', ');
    const rows = this.db.raw
      .prepare(
        `SELECT j.*, n.max_x AS anchor_x, n.min_y AS anchor_y, n.layer_id AS anchor_layer_id
         FROM async_jobs j
         INNER JOIN spatial_nodes n ON j.anchor_node_id = n.id
         WHERE j.anchor_node_id IN (${placeholders})`
      )
      .all(...anchorIds);
    return rows.map(parseJobWithAnchorRow);
  }

  public deleteJobsForAnchorNodes(anchorIds: readonly NodeId[]): void {
    if (anchorIds.length === 0) return;
    const placeholders = anchorIds.map(() => '?').join(', ');
    this.db.raw
      .prepare(`DELETE FROM async_jobs WHERE anchor_node_id IN (${placeholders})`)
      .run(...anchorIds);
  }
}
