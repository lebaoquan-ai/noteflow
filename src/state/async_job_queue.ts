import {
  jobId,
  type CanvasId,
  type JobId,
  type NodeId,
} from '../core/canvas/types.js';
import { UpdateJobBadgeToolSchema } from '../ai/agent_contract.js';
import type { NoteFlowDatabase } from '../db/client.js';
import type {
  AsyncJobBadgeRecord,
  AsyncJobRepository,
  AsyncJobType,
} from '../db/repositories/async_job_repository.js';
import type { SpatialNodeRepository } from '../db/repositories/spatial_node_repository.js';

export class AsyncJobQueue {
  private readonly abortControllers = new Map<JobId, AbortController>();
  private readonly nodeToJobIds = new Map<NodeId, Set<JobId>>();
  private readonly jobToAnchorCluster = new Map<JobId, NodeId>();

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly nodeRepo: SpatialNodeRepository,
    private readonly jobRepo: AsyncJobRepository
  ) {}

  public enqueueClusterJob(params: {
    canvasId: CanvasId;
    anchorClusterId: NodeId;
    jobType: AsyncJobType;
    memberStrokeIds?: readonly NodeId[];
  }): AsyncJobBadgeRecord {
    const newJobId = jobId(crypto.randomUUID());
    const controller = new AbortController();
    this.abortControllers.set(newJobId, controller);
    this.jobToAnchorCluster.set(newJobId, params.anchorClusterId);

    this.indexNodeJob(params.anchorClusterId, newJobId);
    if (params.memberStrokeIds) {
      for (const strokeId of params.memberStrokeIds) {
        this.indexNodeJob(strokeId, newJobId);
      }
    }

    return this.jobRepo.enqueueJob({
      id: newJobId,
      canvasId: params.canvasId,
      anchorNodeId: params.anchorClusterId,
      jobType: params.jobType,
    });
  }

  public getAbortSignal(targetJobId: JobId): AbortSignal | undefined {
    return this.abortControllers.get(targetJobId)?.signal;
  }

  public markJobRunning(targetJobId: JobId): AsyncJobBadgeRecord | null {
    const controller = this.abortControllers.get(targetJobId);
    if (controller?.signal.aborted) return null;
    return this.jobRepo.updateJobStatus(targetJobId, 'running', null);
  }

  /**
   * Validates the AI Agent's `UpdateJobBadgeTool` payload with Zod and updates
   * the job badge in SQLite unless the job was cancelled/undone.
   */
  public applyToolUpdate(rawInput: unknown): boolean {
    const parsed = UpdateJobBadgeToolSchema.parse(rawInput);
    const targetJobId = jobId(parsed.jobId);

    const controller = this.abortControllers.get(targetJobId);
    if (controller?.signal.aborted) {
      return false;
    }

    const existing = this.jobRepo.getBadgeById(targetJobId);
    if (!existing) {
      return false;
    }

    const resultPayload: Record<string, unknown> = {
      badgeState: parsed.badgeState,
      tooltipMessage: parsed.tooltipMessage,
      ...(parsed.linkedZettelId ? { linkedZettelId: parsed.linkedZettelId } : {}),
    };

    this.jobRepo.updateJobStatus(targetJobId, parsed.status, resultPayload);
    return true;
  }

  /**
   * Aborts any in-flight or queued AI jobs associated with the given node IDs
   * (either as the anchor cluster or as a member stroke that was undone/erased)
   * and removes their job rows from SQLite so no zombie badges remain.
   */
  public cancelJobsForNodes(nodeIds: readonly NodeId[]): void {
    if (nodeIds.length === 0) return;

    const jobsToCancel = new Set<JobId>();
    const anchorsToClean = new Set<NodeId>(nodeIds);

    for (const id of nodeIds) {
      const tracked = this.nodeToJobIds.get(id);
      if (tracked) {
        for (const jId of tracked) {
          jobsToCancel.add(jId);
          const anchor = this.jobToAnchorCluster.get(jId);
          if (anchor) anchorsToClean.add(anchor);
        }
      }
    }

    for (const jId of jobsToCancel) {
      const controller = this.abortControllers.get(jId);
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
    }

    this.db.transaction(() => {
      this.jobRepo.deleteJobsForAnchorNodes([...anchorsToClean]);
      void this.nodeRepo;
    });
  }

  private indexNodeJob(id: NodeId, targetJobId: JobId): void {
    let set = this.nodeToJobIds.get(id);
    if (!set) {
      set = new Set<JobId>();
      this.nodeToJobIds.set(id, set);
    }
    set.add(targetJobId);
  }
}
