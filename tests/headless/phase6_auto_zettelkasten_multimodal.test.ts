import { describe, it, expect } from 'vitest';
import { NoteFlowDatabase } from '../../src/db/client.js';
import { BrowserSqlEngine } from '../../src/db/browser_sql_engine.js';
import { CanvasStore } from '../../src/state/canvas_store.js';
import { ZettelRepository } from '../../src/db/repositories/zettel_repository.js';
import { SliceEraseCommand } from '../../src/core/commands/slice_erase_command.js';
import { worldPoint } from '../../src/core/canvas/types.js';

/**
 * Helper to create a closed circular/oval loop polygon around [minX, minY, maxX, maxY].
 */
function makeCircleLoopPoints(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  steps: number = 24
): Float32Array {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const pts = new Float32Array((steps + 1) * 4);
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    pts[i * 4] = cx + Math.cos(theta) * rx;
    pts[i * 4 + 1] = cy + Math.sin(theta) * ry;
    pts[i * 4 + 2] = 0.65;
    pts[i * 4 + 3] = 100 + i * 10;
  }
  return pts;
}

describe('Phase 6: Smart Gesture/Symbol Recognizer & Auto-Updating Multimodal Zettelkasten Database', () => {
  it('Phase 6.1: Registers 100% of canvas words in canvas_blocks, but ONLY promotes symbol-marked keywords (Circle, Underline, Double-Underline, #tag, !axiom) to Atomic Zettels', () => {
    const store = CanvasStore.createInMemory('Auto Zettelkasten Keyword Promotion');
    const zettelRepo = new ZettelRepository(store.db);
    const notesLayer = store.getLayerByType('notes');

    // 1. Write a prose stroke ("Backpropagation") at (100, 100) -> (240, 115)
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        100, 108, 0.6, 10,
        170, 110, 0.7, 20,
        240, 108, 0.6, 30,
      ]),
      ocrText: 'Backpropagation computes layer gradients via chain rule',
    });

    // 2. Circle the word "Backpropagation" with an enclosure loop around (90, 90) -> (250, 130)
    store.commitStroke({
      layerId: notesLayer.id,
      points: makeCircleLoopPoints(90, 90, 250, 130),
      ocrText: 'Backpropagation',
    });

    // 3. Write an UNMARKED supporting explanation block far away at (100, 420)
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        100, 420, 0.5, 200,
        260, 422, 0.5, 220,
      ]),
      ocrText: 'Unmarked supporting observation about learning rate warmup',
    });

    // 4. Write a Double-Underlined core theorem ("Bellman Optimality") at (500, 100)
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        500, 105, 0.6, 300,
        650, 105, 0.6, 320,
      ]),
      ocrText: 'Bellman Optimality',
    });
    // First underline at y=120
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        498, 120, 0.7, 330,
        575, 120, 0.7, 340,
        652, 120, 0.7, 350,
      ]),
    });
    // Second parallel underline at y=126 (within 18px -> upgrades to double_underline)
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        498, 126, 0.7, 360,
        575, 126, 0.7, 370,
        652, 126, 0.7, 380,
      ]),
    });

    // Run clustering + auto-Zettelkasten sync
    store.syncZettelkastenNow(notesLayer.id);

    // A: 100% of blocks (both marked and unmarked) must be registered & searchable in canvas_blocks
    const allBlocks = zettelRepo.getCanvasBlocks(store.canvasId);
    expect(allBlocks.length).toBe(3);

    const warmupHits = zettelRepo.searchCanvasBlocks(
      store.canvasId,
      'learning rate warmup'
    );
    expect(warmupHits).toHaveLength(1);
    expect(warmupHits[0]!.rawText).toContain('learning rate warmup');

    // B: ONLY symbol-marked keywords ("Backpropagation" via circle, "Bellman Optimality" via double_underline)
    // are promoted into zettel_keywords and zettels!
    const keywords = zettelRepo.getZettelKeywords(store.canvasId);
    const keywordTexts = keywords.map((k) => k.keywordText);
    expect(keywordTexts).toContain('Backpropagation');
    expect(keywordTexts).toContain('Bellman Optimality');
    expect(
      keywordTexts.some((k) => k.toLowerCase().includes('learning rate warmup'))
    ).toBe(false);

    const bellmanKw = keywords.find((k) => k.keywordText === 'Bellman Optimality')!;
    expect(bellmanKw.markerType).toBe('double_underline');
    expect(bellmanKw.isPrimaryConcept).toBe(true);

    const backpropKw = keywords.find((k) => k.keywordText === 'Backpropagation')!;
    expect(backpropKw.markerType).toBe('circle');

    const zettels = zettelRepo.getAllZettels();
    expect(zettels.map((z) => z.title)).toContain('Backpropagation');
    expect(zettels.map((z) => z.title)).toContain('Bellman Optimality');
    expect(zettels).toHaveLength(2);
  });

  it('Phase 6.2: Links non-text freehand Sketches/Graphs (sketch_diagram) and Comparison Tables (comparison_table) to Atomic Zettels via pointing arrows (A ──> B)', () => {
    const store = CanvasStore.createInMemory('Multimodal Sketch & Table Linking');
    const zettelRepo = new ZettelRepository(store.db);
    const notesLayer = store.getLayerByType('notes');

    // 1. Marked Concept Cluster at (100, 100) -> (240, 130): "#GradientDescent !axiom"
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        100, 110, 0.6, 10,
        170, 112, 0.6, 20,
        240, 110, 0.6, 30,
      ]),
      ocrText: '#GradientDescent !axiom Loss landscape convergence',
    });

    // 2. Non-text Freehand Loss Curve Sketch/Graph at (420, 80) -> (580, 200) (no OCR text, multi-stroke curve + axes)
    // Axis stroke
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        420, 80, 0.6, 100,
        420, 200, 0.6, 110,
        580, 200, 0.6, 120,
      ]),
    });
    // Convex curve stroke inside axes
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        430, 95, 0.6, 130,
        460, 165, 0.6, 140,
        510, 190, 0.6, 150,
        565, 130, 0.6, 160,
      ]),
    });

    // 3. Draw a Pointing Arrow from the #GradientDescent cluster (245, 115) ──> Sketch Diagram (412, 140)
    // Shaft + V-head at tip
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        245, 115, 0.6, 200,
        330, 128, 0.6, 210,
        412, 140, 0.6, 220,
        396, 130, 0.6, 225,
        412, 140, 0.6, 230,
        398, 150, 0.6, 235,
      ]),
    });

    // 4. Draw a Comparison Table below at (100, 220) -> (280, 320) with intersecting H and V grid lines
    // Horizontal divider line
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        100, 255, 0.6, 300,
        190, 255, 0.6, 310,
        280, 255, 0.6, 320,
      ]),
    });
    // Vertical divider line intersecting horizontal divider at (190, 255)
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        190, 220, 0.6, 330,
        190, 270, 0.6, 340,
        190, 320, 0.6, 350,
      ]),
      ocrText: 'SGD | Adam\nO(1/k) | Adaptive moment',
    });

    store.syncZettelkastenNow(notesLayer.id);

    const zettels = zettelRepo.getAllZettels();
    expect(zettels).toHaveLength(1);
    const gdZettel = zettels[0]!;
    expect(gdZettel.title).toBe('GradientDescent');

    // Verify modalities in canvas_blocks
    const blocks = zettelRepo.getCanvasBlocks(store.canvasId);
    const sketchBlock = blocks.find((b) => b.modality === 'sketch_diagram');
    const tableBlock = blocks.find((b) => b.modality === 'comparison_table');
    expect(sketchBlock).toBeDefined();
    expect(tableBlock).toBeDefined();

    // Verify both the non-text sketch_diagram (via pointing_arrow_support) and comparison_table (via section_flow)
    // are bound as supporting evidence to the #GradientDescent Atomic Zettel!
    const evidenceLinks = zettelRepo.getEvidenceLinksForZettel(gdZettel.id);
    const linkedBlockIds = evidenceLinks.map((e) => e.blockId);
    expect(linkedBlockIds).toContain(sketchBlock!.id);
    expect(linkedBlockIds).toContain(tableBlock!.id);

    const arrowEvidence = evidenceLinks.find((e) => e.blockId === sketchBlock!.id)!;
    expect(arrowEvidence.evidenceRole).toBe('pointing_arrow_support');

    // Summary markdown of the Zettel should reference both the Sketch Diagram and Comparison Table
    const updatedZettel = zettelRepo.getById(gdZettel.id)!;
    expect(updatedZettel.summaryMarkdown).toContain('[Sketch Diagram]');
    expect(updatedZettel.summaryMarkdown).toContain('[Comparison Table]');
  });

  it('Phase 6.3: Extracts [ ] / @date Agenda Tasks and maintains full Erase + Undo/Redo symmetry without ghost Zettels', () => {
    const engine = new BrowserSqlEngine();
    const db = new NoteFlowDatabase(engine);
    const store = CanvasStore.fromDatabase(db, 'Reactive Undo/Redo Zettel Sync');
    const zettelRepo = new ZettelRepository(db);
    const notesLayer = store.getLayerByType('notes');

    // 1. Write an agenda task with checkbox sigil [ ] and @date hook
    store.commitStroke({
      layerId: notesLayer.id,
      points: new Float32Array([
        80, 80, 0.6, 10,
        240, 80, 0.6, 20,
      ]),
      ocrText: '[ ] Derive Hessian bound @2026-11-01 #ConvexOptimization',
    });

    store.syncZettelkastenNow(notesLayer.id);

    // Verify agenda task + #ConvexOptimization Zettel exist
    expect(zettelRepo.getAgendaTasks(store.canvasId)).toHaveLength(1);
    expect(zettelRepo.getAgendaTasks(store.canvasId)[0]!.dueDateIso).toBe(
      '2026-11-01'
    );
    expect(zettelRepo.getAllZettels()).toHaveLength(1);
    expect(zettelRepo.getAllZettels()[0]!.title).toBe('ConvexOptimization');

    // Verify BrowserSqlEngine snapshot export/import preserves all 5 new Phase 6 tables
    const snap = engine.exportSnapshot();
    expect(snap.canvasBlocks?.length).toBeGreaterThanOrEqual(1);
    expect(snap.zettelKeywords?.length).toBe(1);
    expect(snap.agendaTasks?.length).toBe(1);

    // 2. Slice-erase the stroke and re-sync -> Zettel, keyword, block, and agenda task must be cleaned up!
    const sliceCmd = new SliceEraseCommand(
      store.db,
      store.nodeRepo,
      store.canvasId,
      worldPoint(150, 60),
      worldPoint(150, 100),
      10,
      1,
      store.getEditableLayerIds()
    );
    store.history.execute(sliceCmd);
    store.syncZettelkastenNow(notesLayer.id);

    expect(zettelRepo.getAllZettels()).toHaveLength(0);
    expect(zettelRepo.getZettelKeywords(store.canvasId)).toHaveLength(0);
    expect(zettelRepo.getAgendaTasks(store.canvasId)).toHaveLength(0);

    // 3. Undo the slice-erase -> stroke returns, and Zettel + agenda task are deterministically restored!
    store.history.undo();
    store.syncZettelkastenNow(notesLayer.id);

    expect(zettelRepo.getAllZettels()).toHaveLength(1);
    expect(zettelRepo.getAllZettels()[0]!.title).toBe('ConvexOptimization');
    expect(zettelRepo.getAgendaTasks(store.canvasId)).toHaveLength(1);
  });
});
