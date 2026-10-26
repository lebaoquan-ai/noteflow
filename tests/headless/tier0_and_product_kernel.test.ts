import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  canvasId,
  layerId,
  nodeId,
  worldAABB,
  type CanvasId,
  type LayerId,
} from '../../src/core/canvas/types.js';
import {
  CommitStrokeCommand,
  CommandHistory,
} from '../../src/core/commands/canvas_command.js';
import { NoteFlowDatabase } from '../../src/db/client.js';
import { SpatialNodeRepository } from '../../src/db/repositories/spatial_node_repository.js';
import { AsyncJobRepository } from '../../src/db/repositories/async_job_repository.js';
import { Tier0StrokeClusterer } from '../../src/ai/tier0_clustering/stroke_clusterer.js';
import { AsyncJobQueue } from '../../src/state/async_job_queue.js';
import {
  CreateZettelCardToolSchema,
  UpdateJobBadgeToolSchema,
} from '../../src/ai/agent_contract.js';

describe('Tier 0 Spatio-Temporal Stroke Clusterer & Product Kernel Loop (Headless Verification)', () => {
  let db: NoteFlowDatabase;
  let nodeRepo: SpatialNodeRepository;
  let jobRepo: AsyncJobRepository;
  let jobQueue: AsyncJobQueue;
  let clusterer: Tier0StrokeClusterer;
  let history: CommandHistory;
  let testCanvasId: CanvasId;
  let notesLayerId: LayerId;

  beforeEach(() => {
    vi.useFakeTimers();
    db = NoteFlowDatabase.createInMemory();
    nodeRepo = new SpatialNodeRepository(db);
    jobRepo = new AsyncJobRepository(db);
    jobQueue = new AsyncJobQueue(db, nodeRepo, jobRepo);
    clusterer = new Tier0StrokeClusterer(db, nodeRepo, jobQueue);

    history = new CommandHistory({
      onCancelJobsForNodes: (ids) => {
        jobQueue.cancelJobsForNodes(ids);
      },
    });

    testCanvasId = canvasId(crypto.randomUUID());
    notesLayerId = layerId(crypto.randomUUID());

    nodeRepo.ensureCanvasAndLayer({
      canvasId: testCanvasId,
      canvasTitle: 'Calculus Proof',
      layerId: notesLayerId,
      layerName: 'My Notes',
      layerType: 'notes',
      zIndex: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it('clusters proximate strokes within dx < 48px and dy < 24px after 1200ms idle debounce while keeping distant strokes separate', () => {
    const strokeWord1 = nodeId(crypto.randomUUID());
    const strokeWord2 = nodeId(crypto.randomUUID());
    const distantDiagramStroke = nodeId(crypto.randomUUID());

    // Word 1: [100, 100, 180, 120]
    history.execute(
      new CommitStrokeCommand(db, nodeRepo, {
        id: strokeWord1,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(100, 100, 180, 120),
        points: new Float32Array([100, 100, 0.6, 10, 180, 120, 0.7, 20]),
        style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
      })
    );
    clusterer.notifyStrokeCommitted({
      strokeId: strokeWord1,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      colorId: 'noir',
    });

    // Word 2: [210, 102, 290, 122] -> dx = 210 - 180 = 30px (< 48px), dy = 0px (< 24px)
    history.execute(
      new CommitStrokeCommand(db, nodeRepo, {
        id: strokeWord2,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(210, 102, 290, 122),
        points: new Float32Array([210, 102, 0.6, 30, 290, 122, 0.7, 40]),
        style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
      })
    );
    clusterer.notifyStrokeCommitted({
      strokeId: strokeWord2,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      colorId: 'noir',
    });

    // Distant stroke: [600, 500, 700, 550] -> dx > 48px, dy > 24px
    history.execute(
      new CommitStrokeCommand(db, nodeRepo, {
        id: distantDiagramStroke,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(600, 500, 700, 550),
        points: new Float32Array([600, 500, 0.6, 50, 700, 550, 0.7, 60]),
        style: { colorId: 'cobalt', width: 2.8, brushType: 'pen' },
      })
    );
    clusterer.notifyStrokeCommitted({
      strokeId: distantDiagramStroke,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      colorId: 'cobalt',
    });

    // Before 1200ms idle debounce expires, no stroke_cluster exists yet
    vi.advanceTimersByTime(1000);
    expect(
      nodeRepo
        .getAllForCanvas(testCanvasId)
        .filter((n) => n.nodeType === 'stroke_cluster')
    ).toHaveLength(0);

    // At 1200ms, Tier 0 clustering runs
    vi.advanceTimersByTime(250);
    const clusters = nodeRepo
      .getAllForCanvas(testCanvasId)
      .filter((n) => n.nodeType === 'stroke_cluster');
    expect(clusters).toHaveLength(2);

    const updatedWord1 = nodeRepo.getById(strokeWord1)!;
    const updatedWord2 = nodeRepo.getById(strokeWord2)!;
    const updatedDistant = nodeRepo.getById(distantDiagramStroke)!;

    expect(updatedWord1.parentClusterId).not.toBeNull();
    expect(updatedWord1.parentClusterId).toBe(updatedWord2.parentClusterId);
    expect(updatedDistant.parentClusterId).not.toBe(updatedWord1.parentClusterId);

    const textCluster = nodeRepo.getById(updatedWord1.parentClusterId!)!;
    expect(textCluster.bbox).toEqual([100, 100, 290, 122]);
  });

  it('executes the end-to-end Phase 0 Product Kernel Loop: Violet AI Highlight -> 0ms cluster -> queued -> running -> completed badge', async () => {
    const mathStrokeId = nodeId(crypto.randomUUID());
    const violetHighlightId = nodeId(crypto.randomUUID());

    // 1. User writes handwritten math stroke
    history.execute(
      new CommitStrokeCommand(db, nodeRepo, {
        id: mathStrokeId,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(50, 80, 220, 120),
        points: new Float32Array([50, 80, 0.6, 10, 220, 120, 0.8, 30]),
        style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
      })
    );

    // 2. User highlights it with the Violet AI Highlighter (#7C3AED)
    history.execute(
      new CommitStrokeCommand(db, nodeRepo, {
        id: violetHighlightId,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(45, 75, 225, 125),
        points: new Float32Array([45, 100, 0.5, 40, 225, 100, 0.5, 60]),
        style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
      })
    );

    // Violet AI Highlighter triggers immediate (0ms debounce) clustering & job enqueue
    clusterer.notifyStrokeCommitted({
      strokeId: violetHighlightId,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      colorId: 'violet',
    });

    const badgesQueued = jobRepo.getBadgesForCanvas(testCanvasId);
    expect(badgesQueued).toHaveLength(1);
    expect(badgesQueued[0]!.jobType).toBe('verify_claim');
    expect(badgesQueued[0]!.status).toBe('queued');
    expect(badgesQueued[0]!.anchorX).toBe(225);
    expect(badgesQueued[0]!.anchorY).toBe(75);

    const activeJobId = badgesQueued[0]!.id;

    // 3. Job transitions to 'running' (🔄)
    jobQueue.markJobRunning(activeJobId);
    expect(jobRepo.getBadgeById(activeJobId)!.status).toBe('running');

    // 4. AI Agent completes verification and submits tool call validated by UpdateJobBadgeToolSchema
    const toolPayload = UpdateJobBadgeToolSchema.parse({
      jobId: activeJobId,
      status: 'completed',
      badgeState: 'verified',
      tooltipMessage: 'Integral identity holds for continuous f(x) on [a, b].',
    });

    jobQueue.applyToolUpdate(toolPayload);

    const completedBadge = jobRepo.getBadgeById(activeJobId)!;
    expect(completedBadge.status).toBe('completed');
    expect(completedBadge.resultJson).toEqual({
      badgeState: 'verified',
      tooltipMessage: 'Integral identity holds for continuous f(x) on [a, b].',
    });
  });

  it('cancels in-flight AI jobs and prevents zombie badges when the user undoes the violet highlight stroke', () => {
    const mathStrokeId = nodeId(crypto.randomUUID());
    const violetHighlightId = nodeId(crypto.randomUUID());

    history.execute(
      new CommitStrokeCommand(db, nodeRepo, {
        id: mathStrokeId,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(50, 80, 220, 120),
        points: new Float32Array([50, 80, 0.6, 10, 220, 120, 0.8, 30]),
        style: { colorId: 'noir', width: 2.8, brushType: 'pen' },
      })
    );

    history.execute(
      new CommitStrokeCommand(db, nodeRepo, {
        id: violetHighlightId,
        canvasId: testCanvasId,
        layerId: notesLayerId,
        bbox: worldAABB(45, 75, 225, 125),
        points: new Float32Array([45, 100, 0.5, 40, 225, 100, 0.5, 60]),
        style: { colorId: 'violet', width: 6.0, brushType: 'highlighter' },
      })
    );

    clusterer.notifyStrokeCommitted({
      strokeId: violetHighlightId,
      canvasId: testCanvasId,
      layerId: notesLayerId,
      colorId: 'violet',
    });

    const badges = jobRepo.getBadgesForCanvas(testCanvasId);
    expect(badges).toHaveLength(1);
    const activeJobId = badges[0]!.id;
    const signal = jobQueue.getAbortSignal(activeJobId);
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);

    jobQueue.markJobRunning(activeJobId);

    // User hits two-finger tap Undo while the AI job is running!
    history.undo();

    // Signal must be aborted and the job removed so no zombie badge remains
    expect(signal!.aborted).toBe(true);
    expect(jobRepo.getBadgesForCanvas(testCanvasId)).toHaveLength(0);

    // Late arrival of an AI tool update for the aborted job must be safely ignored
    const applied = jobQueue.applyToolUpdate({
      jobId: activeJobId,
      status: 'completed',
      badgeState: 'verified',
      tooltipMessage: 'Late response after undo',
    });
    expect(applied).toBe(false);
    expect(jobRepo.getBadgesForCanvas(testCanvasId)).toHaveLength(0);
  });

  it('validates CreateZettelCardToolSchema at the AI boundary', () => {
    const valid = CreateZettelCardToolSchema.safeParse({
      anchorClusterId: crypto.randomUUID(),
      title: 'Fundamental Theorem of Calculus',
      summaryMarkdown: 'Links differentiation and definite integration.',
      latexBlocks: ['\\int_a^b f(x)\\,dx = F(b) - F(a)'],
      verificationState: 'verified',
      worldPosition: { x: 300, y: 120 },
    });
    expect(valid.success).toBe(true);
  });
});
