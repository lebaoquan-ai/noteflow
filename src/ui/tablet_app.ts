import {
  screenPoint,
  worldAABB,
  type SemanticColor,
} from '../core/canvas/types.js';
import { screenToWorld } from '../core/canvas/math.js';
import { CreateZettelCardCommand } from '../core/commands/zettel_commands.js';
import {
  CompileMathBlockCommand,
  DragToCiteCommand,
} from '../core/commands/math_and_media_commands.js';
import {
  CreateZettelCardToolSchema,
  UpdateJobBadgeToolSchema,
} from '../ai/agent_contract.js';
import { ZettelRepository } from '../db/repositories/zettel_repository.js';
import {
  CanvasStore,
  type RadialToolSlot,
} from '../state/canvas_store.js';
import {
  DualCanvasRenderer,
  SEMANTIC_COLOR_HEX,
  type Canvas2DContextLike,
} from './scene_graph/canvas_renderer.js';
import { exportCanvasArtboardSvg } from './scene_graph/artboard_exporter.js';
import {
  TabletPointerBridge,
  type BridgePointerEvent,
} from './scene_graph/pointer_bridge.js';
import type { PointerSampleEvent } from './scene_graph/wet_ink_buffer.js';

function adaptDomPointerEvent(e: PointerEvent): BridgePointerEvent {
  return {
    pointerId: e.pointerId,
    pointerType: e.pointerType || 'mouse',
    clientX: e.clientX,
    clientY: e.clientY,
    pressure: e.pressure,
    timeStamp: e.timeStamp,
    getCoalescedEvents:
      typeof e.getCoalescedEvents === 'function'
        ? (): readonly PointerSampleEvent[] =>
            e.getCoalescedEvents().map((ce) => ({
              pointerType: ce.pointerType || e.pointerType || 'mouse',
              clientX: ce.clientX,
              clientY: ce.clientY,
              pressure: ce.pressure,
              timeStamp: ce.timeStamp,
            }))
        : undefined,
    getPredictedEvents:
      typeof e.getPredictedEvents === 'function'
        ? (): readonly PointerSampleEvent[] =>
            e.getPredictedEvents().map((pe) => ({
              pointerType: pe.pointerType || e.pointerType || 'mouse',
              clientX: pe.clientX,
              clientY: pe.clientY,
              pressure: pe.pressure,
              timeStamp: pe.timeStamp,
            }))
        : undefined,
  };
}

export class NoteFlowTabletApp {
  public readonly store: CanvasStore;
  public readonly zettelRepo: ZettelRepository;
  public readonly renderer: DualCanvasRenderer;
  public readonly bridge: TabletPointerBridge;

  private readonly dryCanvas: HTMLCanvasElement;
  private readonly wetCanvas: HTMLCanvasElement;
  private readonly dryCtx: Canvas2DContextLike;
  private readonly wetCtx: Canvas2DContextLike;

  private viewportWidth = 1024;
  private viewportHeight = 768;
  private dpr = 1;
  private dryRafPending = false;
  private selectedNodeIds = new Set<string>();
  private readonly scheduledJobs = new Set<string>();

  private lastPointerType = 'pen';
  private lastPressure = 0.5;
  private lastCoalescedCount = 1;

  public constructor(private readonly root: HTMLElement) {
    this.store = CanvasStore.createInMemory('NoteFlow Tablet Prototype');
    this.zettelRepo = new ZettelRepository(this.store.db);
    this.renderer = new DualCanvasRenderer();

    this.root.innerHTML = this.buildShellHtml();

    this.dryCanvas = this.root.querySelector<HTMLCanvasElement>('#dry-canvas')!;
    this.wetCanvas = this.root.querySelector<HTMLCanvasElement>('#wet-canvas')!;

    const rawDryCtx = this.dryCanvas.getContext('2d', { alpha: false });
    // Request low-latency desynchronized hardware overlay for <4ms wet-ink response
    const rawWetCtx =
      this.wetCanvas.getContext('2d', { desynchronized: true }) ??
      this.wetCanvas.getContext('2d');

    if (!rawDryCtx || !rawWetCtx) {
      throw new Error('Failed to initialize 2D canvas contexts.');
    }

    this.dryCtx = rawDryCtx as unknown as Canvas2DContextLike;
    this.wetCtx = rawWetCtx as unknown as Canvas2DContextLike;

    this.bridge = new TabletPointerBridge(this.store, {
      onWetRepaint: () => {
        this.renderWetImmediate();
      },
      onDryRepaint: () => {
        this.scheduleDryRender();
        this.pumpBackgroundAiJobs();
        this.updateHudState();
      },
      onStateChange: () => {
        this.updateHudState();
      },
      onLassoSelection: (ids) => {
        this.selectedNodeIds = new Set(ids);
        this.scheduleDryRender();
      },
    });

    this.bindViewportResize();
    this.bindPointerEvents();
    this.bindToolbarEvents();
    this.seedStarterCanvas();
    this.scheduleDryRender();
    this.updateHudState();
  }

  private buildShellHtml(): string {
    return `
      <div class="nf-viewport">
        <canvas id="dry-canvas" class="nf-canvas nf-dry-canvas"></canvas>
        <canvas id="wet-canvas" class="nf-canvas nf-wet-canvas"></canvas>

        <!-- Top Telemetry & Smart Layer Bar -->
        <header class="nf-top-bar">
          <div class="nf-brand">
            <span class="nf-brand-dot"></span>
            <strong>NoteFlow</strong>
            <span class="nf-badge-pill" id="hud-fsm-state">IDLE</span>
            <span class="nf-telemetry" id="hud-telemetry">pen • p:0.50 • 1.00x</span>
          </div>

          <div class="nf-layer-bar" id="layer-toggles">
            <button class="nf-chip nf-chip-active" data-layer="notes" title="Toggle Layer 0: My Notes">
              1. Notes
            </button>
            <button class="nf-chip nf-chip-active" data-layer="hints_work" title="Toggle Layer 1: Hints & Scratchpad">
              2. Scratchpad
            </button>
            <button class="nf-chip nf-chip-active" data-layer="ai_feedback" title="Toggle Layer 2: AI Annotations">
              3. AI Verify
            </button>
            <button class="nf-chip nf-chip-active" data-layer="math_formal" title="Toggle Layer 3: LaTeX & Formal Proofs">
              4. LaTeX
            </button>
            <button class="nf-chip nf-chip-teaching" id="btn-teaching-mode" title="One-Tap Teaching Mode (Hides Scratchpad & AI Hints)">
              🎓 Teaching Mode: OFF
            </button>
          </div>

          <div class="nf-history-bar">
            <button class="nf-btn" id="btn-undo" title="Undo (or 2-Finger Tap)">↶ Undo</button>
            <button class="nf-btn" id="btn-redo" title="Redo (or 3-Finger Tap)">↷ Redo</button>
            <button class="nf-btn" id="btn-reset-camera" title="Reset Camera Zoom & Pan">⌖ 100%</button>
          </div>
        </header>

        <!-- Left Docked Radial Tool Palette -->
        <aside class="nf-tool-dock">
          <div class="nf-dock-section-label">TOOLS</div>
          <button class="nf-tool-btn nf-tool-active" data-tool="fountain_pen">
            ✒️ <span>Fine Pen</span>
          </button>
          <button class="nf-tool-btn" data-tool="felt_tip_marker">
            🖍️ <span>Marker</span>
          </button>
          <button class="nf-tool-btn nf-tool-violet" data-tool="ai_highlighter">
            ✨ <span>AI Violet</span>
          </button>
          <button class="nf-tool-btn" data-tool="freehand_lasso">
            ➰ <span>Lasso</span>
          </button>
          <button class="nf-tool-btn" data-tool="stroke_eraser">
            ✂️ <span>Slice Erase</span>
          </button>
          <button class="nf-tool-btn" data-tool="pan_laser">
            🔴 <span>Laser</span>
          </button>

          <div class="nf-dock-divider"></div>
          <div class="nf-dock-section-label">INK COLOR</div>
          <div class="nf-color-row" id="color-swatches">
            <button class="nf-swatch nf-swatch-active" data-color="noir" style="background:${SEMANTIC_COLOR_HEX.noir}" title="Noir"></button>
            <button class="nf-swatch" data-color="cobalt" style="background:${SEMANTIC_COLOR_HEX.cobalt}" title="Cobalt"></button>
            <button class="nf-swatch" data-color="crimson" style="background:${SEMANTIC_COLOR_HEX.crimson}" title="Crimson"></button>
            <button class="nf-swatch" data-color="forest" style="background:${SEMANTIC_COLOR_HEX.forest}" title="Forest"></button>
            <button class="nf-swatch" data-color="amber" style="background:${SEMANTIC_COLOR_HEX.amber}" title="Amber"></button>
            <button class="nf-swatch" data-color="violet" style="background:${SEMANTIC_COLOR_HEX.violet}" title="Violet (Triggers AI)"></button>
          </div>

          <div class="nf-dock-divider"></div>
          <div class="nf-dock-section-label">WIDTH</div>
          <div class="nf-width-row" id="width-buttons">
            <button class="nf-width-btn" data-width="1.6">Fine</button>
            <button class="nf-width-btn nf-width-active" data-width="2.8">Med</button>
            <button class="nf-width-btn" data-width="5.2">Bold</button>
          </div>
        </aside>

        <!-- Right Quick Spatial Actions & Split-Screen Citation Drawer -->
        <aside class="nf-action-dock">
          <div class="nf-dock-section-label">SPATIAL ACTIONS</div>
          <button class="nf-action-btn" id="btn-spawn-zettel">
            ⚛ + Zettel Card
          </button>
          <button class="nf-action-btn" id="btn-spawn-citation">
            📄 + PDF Citation
          </button>
          <button class="nf-action-btn" id="btn-spawn-math">
            ∑ + LaTeX Block
          </button>
          <button class="nf-action-btn" id="btn-export-svg">
            📤 Export SVG
          </button>
        </aside>

        <!-- Bottom Gesture Hint Pill -->
        <footer class="nf-footer-hint">
          <span><strong>Stylus/Mouse:</strong> Draw (<4ms Wet Ink)</span>
          <span>•</span>
          <span><strong>1-Finger Drag:</strong> Pan</span>
          <span>•</span>
          <span><strong>2-Finger Pinch:</strong> Zoom</span>
          <span>•</span>
          <span><strong>2-Finger Tap:</strong> Undo</span>
          <span>•</span>
          <span><strong>1-Finger Hold + Pen:</strong> Magic Lasso</span>
        </footer>
      </div>
    `;
  }

  private bindViewportResize(): void {
    const updateSize = (): void => {
      const rect = this.root.getBoundingClientRect();
      this.viewportWidth = Math.max(320, Math.floor(rect.width || window.innerWidth));
      this.viewportHeight = Math.max(240, Math.floor(rect.height || window.innerHeight));
      this.dpr = Math.min(window.devicePixelRatio || 1, 3);

      for (const canvas of [this.dryCanvas, this.wetCanvas]) {
        canvas.width = Math.floor(this.viewportWidth * this.dpr);
        canvas.height = Math.floor(this.viewportHeight * this.dpr);
        canvas.style.width = `${this.viewportWidth}px`;
        canvas.style.height = `${this.viewportHeight}px`;
      }

      this.renderDryImmediate();
      this.renderWetImmediate();
    };

    updateSize();
    window.addEventListener('resize', updateSize);
  }

  private bindPointerEvents(): void {
    this.wetCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      try {
        this.wetCanvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if synthetic event in test environment lacks pointer capture
      }
      this.lastPointerType = e.pointerType || 'mouse';
      this.lastPressure = e.pressure || 0.5;
      this.bridge.handlePointerDown(adaptDomPointerEvent(e));
      this.updateHudState();
    });

    this.wetCanvas.addEventListener('pointermove', (e: PointerEvent) => {
      e.preventDefault();
      const adapted = adaptDomPointerEvent(e);
      this.lastPointerType = adapted.pointerType;
      this.lastPressure = adapted.pressure;
      this.lastCoalescedCount = adapted.getCoalescedEvents?.().length ?? 1;
      this.bridge.handlePointerMove(adapted);
    });

    const handleEnd = (e: PointerEvent): void => {
      e.preventDefault();
      try {
        if (this.wetCanvas.hasPointerCapture(e.pointerId)) {
          this.wetCanvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
      this.bridge.handlePointerUp(adaptDomPointerEvent(e));
      this.pumpBackgroundAiJobs();
      this.updateHudState();
    };

    this.wetCanvas.addEventListener('pointerup', handleEnd);
    this.wetCanvas.addEventListener('pointercancel', (e: PointerEvent) => {
      e.preventDefault();
      this.bridge.handlePointerCancel(adaptDomPointerEvent(e));
      this.updateHudState();
    });

    // Desktop trackpad / mouse wheel zoom & pan convenience for testing
    this.wetCanvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
          this.store.zoomCamera(screenPoint(e.clientX, e.clientY), zoomFactor);
        } else {
          this.store.panCamera(-e.deltaX, -e.deltaY);
        }
        this.scheduleDryRender();
        this.updateHudState();
      },
      { passive: false }
    );
  }

  private bindToolbarEvents(): void {
    // Tool buttons
    const toolButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-tool]');
    toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool as RadialToolSlot;
        this.store.selectRadialTool(tool);
        toolButtons.forEach((b) => b.classList.toggle('nf-tool-active', b === btn));
        this.syncSwatchSelection();
        this.updateHudState();
      });
    });

    // Color swatches
    const swatches = this.root.querySelectorAll<HTMLButtonElement>('[data-color]');
    swatches.forEach((swatch) => {
      swatch.addEventListener('click', () => {
        const color = swatch.dataset.color as SemanticColor;
        this.store.setStrokeColor(color);
        this.syncSwatchSelection();
      });
    });

    // Width buttons
    const widthBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-width]');
    widthBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = Number(btn.dataset.width ?? 2.8);
        this.store.setStrokeWidth(w);
        widthBtns.forEach((b) => b.classList.toggle('nf-width-active', b === btn));
      });
    });

    // Layer toggles
    const layerBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-layer]');
    layerBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const layerType = btn.dataset.layer as
          | 'notes'
          | 'hints_work'
          | 'ai_feedback'
          | 'math_formal';
        const layer = this.store.getLayerByType(layerType);
        layer.isVisible = !layer.isVisible;
        this.syncLayerButtons();
        this.scheduleDryRender();
      });
    });

    // Teaching Mode toggle
    const teachingBtn = this.root.querySelector<HTMLButtonElement>('#btn-teaching-mode')!;
    teachingBtn.addEventListener('click', () => {
      const next = !this.store.isTeachingMode;
      this.store.setTeachingMode(next);
      teachingBtn.textContent = next
        ? '🎓 Teaching Mode: ON'
        : '🎓 Teaching Mode: OFF';
      teachingBtn.classList.toggle('nf-chip-teaching-on', next);
      this.syncLayerButtons();
      this.scheduleDryRender();
    });

    // Undo / Redo / Reset Camera
    this.root.querySelector('#btn-undo')?.addEventListener('click', () => {
      this.store.history.undo();
      this.scheduleDryRender();
      this.updateHudState();
    });
    this.root.querySelector('#btn-redo')?.addEventListener('click', () => {
      this.store.history.redo();
      this.scheduleDryRender();
      this.updateHudState();
    });
    this.root.querySelector('#btn-reset-camera')?.addEventListener('click', () => {
      const cam = this.store.camera;
      this.store.panCamera(-cam.panX, -cam.panY);
      this.store.zoomCamera(screenPoint(0, 0), 1 / cam.zoom);
      this.scheduleDryRender();
      this.updateHudState();
    });

    // Quick Spatial Action Buttons (all execute undoable CanvasCommands!)
    this.root.querySelector('#btn-spawn-zettel')?.addEventListener('click', () => {
      this.spawnSampleZettelCard();
    });
    this.root.querySelector('#btn-spawn-citation')?.addEventListener('click', () => {
      this.spawnSamplePdfCitation();
    });
    this.root.querySelector('#btn-spawn-math')?.addEventListener('click', () => {
      this.spawnSampleMathBlock();
    });
    this.root.querySelector('#btn-export-svg')?.addEventListener('click', () => {
      this.downloadArtboardSvg();
    });
  }

  private downloadArtboardSvg(): void {
    const frame = this.store.buildSceneFrame(
      this.viewportWidth,
      this.viewportHeight
    );
    const svg = exportCanvasArtboardSvg(frame, 'NoteFlow Lecture Artboard');
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `noteflow-artboard-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private syncSwatchSelection(): void {
    const activeColor = this.store.strokeStyle.colorId;
    const swatches = this.root.querySelectorAll<HTMLButtonElement>('[data-color]');
    swatches.forEach((s) => {
      s.classList.toggle('nf-swatch-active', s.dataset.color === activeColor);
    });
  }

  private syncLayerButtons(): void {
    const layerBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-layer]');
    layerBtns.forEach((btn) => {
      const layerType = btn.dataset.layer as
        | 'notes'
        | 'hints_work'
        | 'ai_feedback'
        | 'math_formal';
      const layer = this.store.getLayerByType(layerType);
      btn.classList.toggle('nf-chip-active', layer.isVisible);
    });
  }

  private seedStarterCanvas(): void {
    const notesLayer = this.store.getLayerByType('notes');
    const aiLayer = this.store.getLayerByType('ai_feedback');

    // Seed an initial handwritten-style curve cluster so the canvas has immediate visual landmarks
    const wavePoints = new Float32Array(20 * 4);
    for (let i = 0; i < 20; i++) {
      wavePoints[i * 4] = 140 + i * 12;
      wavePoints[i * 4 + 1] = 180 + Math.sin(i * 0.45) * 18;
      wavePoints[i * 4 + 2] = 0.55 + Math.sin(i * 0.2) * 0.25;
      wavePoints[i * 4 + 3] = i * 8;
    }
    this.store.commitStroke({
      layerId: notesLayer.id,
      points: wavePoints,
      style: { colorId: 'cobalt', width: 2.8, brushType: 'pen' },
    });

    const clusters = this.store.clusterer.clusterLayerNow(
      this.store.canvasId,
      notesLayer.id
    );
    const anchorClusterId = clusters[0]!;

    const validatedZettelInput = CreateZettelCardToolSchema.parse({
      title: 'Welcome to NoteFlow (Stylus-First)',
      summaryMarkdown:
        'Draw with your stylus, or select AI Violet to trigger live ◌ → ↻ → ● verification badges.',
      latexBlocks: ['\\mathcal{F}(\\omega) = \\int_{-\\infty}^{\\infty} f(t)e^{-i\\omega t}dt'],
      verificationState: 'verified',
      anchorClusterId,
      worldPosition: { x: 430, y: 120 },
    });

    this.store.history.execute(
      new CreateZettelCardCommand(
        this.store.db,
        this.store.nodeRepo,
        this.zettelRepo,
        {
          canvasId: this.store.canvasId,
          layerId: aiLayer.id,
          toolInput: validatedZettelInput,
          embedding: null,
        }
      )
    );
  }

  private spawnSampleZettelCard(): void {
    const center = screenToWorld(
      screenPoint(this.viewportWidth * 0.5, this.viewportHeight * 0.45),
      this.store.camera
    );
    const notesLayer = this.store.getLayerByType('notes');
    const existingClusters = this.store.nodeRepo
      .queryViewportRTree(
        this.store.canvasId,
        worldAABB(-10000, -10000, 10000, 10000)
      )
      .filter((n) => n.nodeType === 'stroke_cluster');

    let anchorClusterId = existingClusters[0]?.id;
    if (!anchorClusterId) {
      this.store.commitStroke({
        layerId: notesLayer.id,
        points: new Float32Array([center.x, center.y, 0.5, 1, center.x + 10, center.y, 0.5, 2]),
      });
      anchorClusterId = this.store.clusterer.clusterLayerNow(
        this.store.canvasId,
        notesLayer.id
      )[0]!;
    }

    const validatedInput = CreateZettelCardToolSchema.parse({
      title: 'Atomic Zettel Synthesis',
      summaryMarkdown: 'Spatially indexed in SQLite R-Tree & undoable via 2-finger tap.',
      latexBlocks: ['E = \\hbar \\omega'],
      verificationState: 'verified',
      anchorClusterId,
      worldPosition: {
        x: Math.round(center.x - 130 + (Math.random() - 0.5) * 60),
        y: Math.round(center.y - 70 + (Math.random() - 0.5) * 60),
      },
    });

    this.store.history.execute(
      new CreateZettelCardCommand(
        this.store.db,
        this.store.nodeRepo,
        this.zettelRepo,
        {
          canvasId: this.store.canvasId,
          layerId: notesLayer.id,
          toolInput: validatedInput,
          embedding: null,
        }
      )
    );
    this.scheduleDryRender();
    this.updateHudState();
  }

  private spawnSamplePdfCitation(): void {
    const center = screenToWorld(
      screenPoint(this.viewportWidth * 0.5, this.viewportHeight * 0.55),
      this.store.camera
    );
    const notesLayer = this.store.getLayerByType('notes');
    const x = Math.round(center.x - 140 + (Math.random() - 0.5) * 60);
    const y = Math.round(center.y - 50 + (Math.random() - 0.5) * 60);

    this.store.history.execute(
      new DragToCiteCommand(this.store.db, this.store.nodeRepo, {
        canvasId: this.store.canvasId,
        layerId: notesLayer.id,
        bbox: worldAABB(x, y, x + 280, y + 96),
        citation: {
          sourcePdfUri: 'luhmann_zettelkasten_1981.pdf',
          pageNumber: 42,
          sourceRect: [40, 120, 480, 210],
          excerptText: 'Communication with slip boxes requires spatial addressability.',
        },
      })
    );
    this.scheduleDryRender();
    this.updateHudState();
  }

  private spawnSampleMathBlock(): void {
    const center = screenToWorld(
      screenPoint(this.viewportWidth * 0.45, this.viewportHeight * 0.35),
      this.store.camera
    );
    const notesLayer = this.store.getLayerByType('notes');
    const mathLayer = this.store.getLayerByType('math_formal');

    const existingClusters = this.store.nodeRepo
      .queryViewportRTree(
        this.store.canvasId,
        worldAABB(-10000, -10000, 10000, 10000)
      )
      .filter((n) => n.nodeType === 'stroke_cluster');

    let anchorClusterId = existingClusters[0]?.id;
    if (!anchorClusterId) {
      this.store.commitStroke({
        layerId: notesLayer.id,
        points: new Float32Array([center.x, center.y, 0.5, 1, center.x + 10, center.y, 0.5, 2]),
      });
      anchorClusterId = this.store.clusterer.clusterLayerNow(
        this.store.canvasId,
        notesLayer.id
      )[0]!;
    }

    const x = Math.round(center.x - 110 + (Math.random() - 0.5) * 50);
    const y = Math.round(center.y - 26 + (Math.random() - 0.5) * 50);

    this.store.history.execute(
      new CompileMathBlockCommand(this.store.db, this.store.nodeRepo, {
        canvasId: this.store.canvasId,
        mathLayerId: mathLayer.id,
        anchorClusterId,
        bbox: worldAABB(x, y, x + 230, y + 52),
        latex: '\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}',
      })
    );
    this.scheduleDryRender();
    this.updateHudState();
  }

  /**
   * Simulates the non-blocking background Web Worker AI progression (`◌` -> `↻` -> `●`)
   * for any newly enqueued `verify_claim` or `synthesize_zettel` jobs so the user
   * can test the live Product Kernel Loop on their tablet while continuing to draw.
   */
  private pumpBackgroundAiJobs(): void {
    const badges = this.store.jobRepo.getBadgesForCanvas(this.store.canvasId);
    for (const badge of badges) {
      if (badge.status === 'queued' && !this.scheduledJobs.has(badge.id)) {
        this.scheduledJobs.add(badge.id);

        // Transition `◌` (queued) -> `↻` (running) after 350ms
        setTimeout(() => {
          const current = this.store.jobRepo.getBadgeById(badge.id);
          if (!current) return;

          const runningUpdate = UpdateJobBadgeToolSchema.parse({
            jobId: badge.id,
            status: 'running',
            summaryMessage: 'Evaluating spatial ink cluster...',
            verificationState: 'unverified',
          });
          this.store.jobQueue.applyToolUpdate(runningUpdate);
          this.scheduleDryRender();
        }, 350);

        // Transition `↻` (running) -> `●` (completed) after 1100ms
        setTimeout(() => {
          const current = this.store.jobRepo.getBadgeById(badge.id);
          if (!current) return;

          const completedUpdate = UpdateJobBadgeToolSchema.parse({
            jobId: badge.id,
            status: 'completed',
            summaryMessage: 'Claim & spatial cluster verified.',
            verificationState: 'verified',
          });
          this.store.jobQueue.applyToolUpdate(completedUpdate);
          this.scheduleDryRender();
        }, 1100);
      }
    }
  }

  private renderWetImmediate(): void {
    this.wetCtx.save();
    this.wetCtx.scale(this.dpr, this.dpr);
    this.renderer.renderWetOverlay(
      this.wetCtx,
      this.viewportWidth,
      this.viewportHeight,
      this.bridge.wetBuffer,
      this.store.strokeStyle,
      this.store.camera.zoom,
      this.store.activeTool,
      this.bridge.gestureState
    );
    this.wetCtx.restore();
  }

  private scheduleDryRender(): void {
    if (this.dryRafPending) return;
    this.dryRafPending = true;
    requestAnimationFrame(() => {
      this.dryRafPending = false;
      this.renderDryImmediate();
    });
  }

  private renderDryImmediate(): void {
    const frame = this.store.buildSceneFrame(
      this.viewportWidth,
      this.viewportHeight
    );

    this.dryCtx.save();
    this.dryCtx.scale(this.dpr, this.dpr);
    // Warm paper background
    this.dryCtx.fillStyle = '#FAF8F5';
    this.dryCtx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    this.renderer.renderDrySceneGraph(
      this.dryCtx,
      this.viewportWidth,
      this.viewportHeight,
      frame,
      this.selectedNodeIds
    );
    this.dryCtx.restore();
  }

  private updateHudState(): void {
    const stateEl = this.root.querySelector('#hud-fsm-state');
    if (stateEl) {
      stateEl.textContent = this.bridge.gestureState;
    }

    const telemetryEl = this.root.querySelector('#hud-telemetry');
    if (telemetryEl) {
      const zoomPct = Math.round(this.store.camera.zoom * 100);
      telemetryEl.textContent = `${this.lastPointerType} • p:${this.lastPressure.toFixed(2)} • ${this.lastCoalescedCount}x coal • ${zoomPct}%`;
    }
  }
}

export function bootstrapTabletApp(): NoteFlowTabletApp | null {
  if (typeof document === 'undefined') return null;
  const root = document.getElementById('app');
  if (!root) return null;
  return new NoteFlowTabletApp(root);
}

bootstrapTabletApp();
