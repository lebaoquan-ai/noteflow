import { describe, expect, it } from 'vitest';
import {
  CreateZettelCardCommand,
  LinkZettelsCommand,
} from '../../src/core/commands/zettel_commands.js';
import { NoteFlowDatabase } from '../../src/db/client.js';
import { ZettelRepository } from '../../src/db/repositories/zettel_repository.js';
import { CanvasStore } from '../../src/state/canvas_store.js';
import { exportCanvasArtboardSvg } from '../../src/ui/scene_graph/artboard_exporter.js';

function makeNormalizedEmbedding(seedIndex: number): Float32Array {
  const vec = new Float32Array(768);
  vec[seedIndex] = 0.9;
  vec[(seedIndex + 1) % 768] = 0.43588989;
  return vec;
}

describe('Phase 3: Zettel Graph, Ghost Links, Teaching Mode & Artboard Export', () => {
  it('discovers semantic Ghost Links and atomically executes/undoes LinkZettelsCommand', () => {
    const store = new CanvasStore(
      NoteFlowDatabase.createBrowserInMemory(),
      'Phase 3 Ghost Links'
    );
    const zettelRepo = new ZettelRepository(store.db);
    const notesLayer = store.getLayerByType('notes');

    // Create anchor cluster
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([20, 20, 0.5, 1, 80, 20, 0.5, 2]),
    });
    const anchorClusterId = store.clusterer.clusterLayerNow(
      store.canvasId,
      notesLayer.id
    )[0]!;

    const embA = makeNormalizedEmbedding(0);
    const embB = makeNormalizedEmbedding(0); // Cosine similarity ~ 1.0 (Ghost Link!)
    const embUnrelated = makeNormalizedEmbedding(200); // Orthogonal (similarity = 0)

    const cmdA = new CreateZettelCardCommand(
      store.db,
      store.nodeRepo,
      zettelRepo,
      {
        canvasId: store.canvasId,
        layerId: notesLayer.id,
        embedding: embA,
        toolInput: {
          title: 'Noether Theorem',
          summaryMarkdown: 'Continuous symmetry implies conservation law.',
          latexBlocks: ['\\partial_\\mu J^\\mu = 0'],
          verificationState: 'verified',
          anchorClusterId,
          worldPosition: { x: 100, y: 100 },
        },
      }
    );

    const cmdB = new CreateZettelCardCommand(
      store.db,
      store.nodeRepo,
      zettelRepo,
      {
        canvasId: store.canvasId,
        layerId: notesLayer.id,
        embedding: embB,
        toolInput: {
          title: 'Hamiltonian Time Invariance',
          summaryMarkdown: 'Time translation symmetry conserves total energy H.',
          latexBlocks: ['\\frac{dH}{dt} = 0'],
          verificationState: 'verified',
          anchorClusterId,
          worldPosition: { x: 420, y: 100 },
        },
      }
    );

    const cmdC = new CreateZettelCardCommand(
      store.db,
      store.nodeRepo,
      zettelRepo,
      {
        canvasId: store.canvasId,
        layerId: notesLayer.id,
        embedding: embUnrelated,
        toolInput: {
          title: 'Mitosis Phases',
          summaryMarkdown: 'Prophase, Metaphase, Anaphase, Telophase.',
          latexBlocks: [],
          verificationState: 'verified',
          anchorClusterId,
          worldPosition: { x: 420, y: 320 },
        },
      }
    );

    store.history.execute(cmdA);
    store.history.execute(cmdB);
    store.history.execute(cmdC);

    // 1. Discover Ghost Links for Zettel A (before explicit linking)
    const ghostLinks = zettelRepo.discoverGhostLinks(cmdA.zettelId, 0.75);
    expect(ghostLinks).toHaveLength(1);
    expect(ghostLinks[0]!.targetZettel.id).toBe(cmdB.zettelId);
    expect(ghostLinks[0]!.similarity).toBeGreaterThan(0.95);

    // 2. Accept Ghost Link via undoable LinkZettelsCommand
    const linkCmd = new LinkZettelsCommand(store.db, zettelRepo, {
      sourceZettelId: cmdA.zettelId,
      targetZettelId: cmdB.zettelId,
      relationType: 'derives_from',
      confidence: ghostLinks[0]!.similarity,
    });
    store.history.execute(linkCmd);

    expect(zettelRepo.getAllLinks()).toHaveLength(1);
    // Once explicitly linked, it is no longer an unlinked Ghost Link candidate
    expect(zettelRepo.discoverGhostLinks(cmdA.zettelId, 0.75)).toHaveLength(0);

    // 3. Undo LinkZettelsCommand -> link removed, Ghost Link re-appears
    expect(store.history.undo()).toBe(true);
    expect(zettelRepo.getAllLinks()).toHaveLength(0);
    expect(zettelRepo.discoverGhostLinks(cmdA.zettelId, 0.75)).toHaveLength(1);

    store.close();
  });

  it('exports SVG Artboard respecting Teaching Mode layer filtering', () => {
    const store = CanvasStore.createInMemory('Phase 3 Lecture Export');
    const zettelRepo = new ZettelRepository(store.db);
    const notesLayer = store.getLayerByType('notes');
    const aiLayer = store.getLayerByType('ai_feedback');

    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([50, 50, 0.6, 1, 150, 60, 0.6, 2]),
    });
    const anchorClusterId = store.clusterer.clusterLayerNow(
      store.canvasId,
      notesLayer.id
    )[0]!;

    // Public lecture Zettel on Layer 0 (notes)
    store.history.execute(
      new CreateZettelCardCommand(store.db, store.nodeRepo, zettelRepo, {
        canvasId: store.canvasId,
        layerId: notesLayer.id,
        embedding: null,
        toolInput: {
          title: 'Public Theorem 1.1',
          summaryMarkdown: 'Visible during lecture.',
          latexBlocks: [],
          verificationState: 'verified',
          anchorClusterId,
          worldPosition: { x: 100, y: 120 },
        },
      })
    );

    // Private AI Hint Card on Layer 2 (ai_feedback)
    store.history.execute(
      new CreateZettelCardCommand(store.db, store.nodeRepo, zettelRepo, {
        canvasId: store.canvasId,
        layerId: aiLayer.id,
        embedding: null,
        toolInput: {
          title: 'Private Speaker AI Hint',
          summaryMarkdown: 'Hidden during Teaching Mode.',
          latexBlocks: [],
          verificationState: 'hint',
          anchorClusterId,
          worldPosition: { x: 400, y: 120 },
        },
      })
    );

    // 1. Normal mode: both cards appear in SVG export
    const fullSvg = exportCanvasArtboardSvg(
      store.buildSceneFrame(1024, 768),
      'Full Study Notes'
    );
    expect(fullSvg).toContain('<svg');
    expect(fullSvg).toContain('Public Theorem 1.1');
    expect(fullSvg).toContain('Private Speaker AI Hint');

    // 2. Teaching Mode ON: private speaker AI hints are stripped from exported SVG
    store.setTeachingMode(true);
    const lectureSvg = exportCanvasArtboardSvg(
      store.buildSceneFrame(1024, 768),
      'Clean Lecture Handout'
    );
    expect(lectureSvg).toContain('Public Theorem 1.1');
    expect(lectureSvg).not.toContain('Private Speaker AI Hint');

    store.close();
  });
});
