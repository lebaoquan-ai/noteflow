import {
  nodeId,
  screenPoint,
  worldAABB,
  type JobId,
  type NodeId,
  type ScreenPoint,
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
import { BrowserSqlEngine } from '../db/browser_sql_engine.js';
import { NoteFlowDatabase } from '../db/client.js';
import { IndexedDbVaultStorage } from '../db/indexeddb_persistence.js';
import {
  CanvasStore,
  type ProjectedJobBadge,
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
  public readonly vaultStorage: IndexedDbVaultStorage;
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
  public inspectedBadgeId: JobId | null = null;
  public pinnedRadialAnchor: ScreenPoint | null = null;
  private pendingBadgeTap: {
    readonly pointerId: number;
    readonly startPt: ScreenPoint;
  } | null = null;

  private lastPointerType = 'pen';
  private lastPressure = 0.5;
  private lastCoalescedCount = 1;

  public constructor(
    private readonly root: HTMLElement,
    options?: {
      readonly db?: NoteFlowDatabase;
      readonly vaultStorage?: IndexedDbVaultStorage;
    }
  ) {
    const db = options?.db ?? NoteFlowDatabase.createBrowserInMemory();
    this.store = CanvasStore.fromDatabase(db, 'NoteFlow Tablet Prototype');
    this.zettelRepo = new ZettelRepository(this.store.db);
    this.vaultStorage = options?.vaultStorage ?? new IndexedDbVaultStorage();
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
    this.bindVaultPersistence();
    this.scheduleDryRender();
    this.updateHudState();
  }

  private bindVaultPersistence(): void {
    const rawEngine = this.store.db.raw;
    if (!(rawEngine instanceof BrowserSqlEngine)) return;

    this.vaultStorage.bindEngine(rawEngine);
    void this.hydrateFromVaultIfPresent();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          void this.vaultStorage.saveImmediate(rawEngine);
        }
      });
    }
  }

  public async hydrateFromVaultIfPresent(): Promise<boolean> {
    const rawEngine = this.store.db.raw;
    if (!(rawEngine instanceof BrowserSqlEngine)) return false;

    const hydrated = await this.vaultStorage.hydrateEngine(rawEngine);
    if (!hydrated) return false;

    this.store.syncFromDatabase('NoteFlow Tablet Prototype');
    this.store.history.clear();
    this.scheduleDryRender();
    this.updateHudState();
    return true;
  }

  public async resetVaultAndReseed(): Promise<void> {
    await this.vaultStorage.clearVault();
    const rawEngine = this.store.db.raw;
    if (rawEngine instanceof BrowserSqlEngine) {
      rawEngine.close();
      this.store.syncFromDatabase('NoteFlow Tablet Prototype');
      this.store.history.clear();
      this.seedStarterCanvas();
      await this.vaultStorage.saveImmediate(rawEngine);
      this.scheduleDryRender();
      this.updateHudState();
    }
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
            <button class="nf-btn" id="btn-rotation-lock" title="Toggle 2-Finger Camera Rotation">🔒 Rotate: OFF</button>
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
          <button class="nf-action-btn" id="btn-toggle-vault" title="Toggle Multimodal Zettel Vault Drawer">
            🗄️ Zettel Vault
          </button>
          <button class="nf-action-btn" id="btn-reset-vault" title="Clear IndexedDB Vault & Reset Starter Canvas">
            🗑️ Reset Vault
          </button>
        </aside>

        <!-- Collapsible Multimodal Zettelkasten Vault Drawer (Decision 1A & 2A) -->
        <aside id="zettel-vault-drawer" class="nf-badge-popover" style="right: 16px; top: 76px; width: 320px; max-height: calc(100vh - 150px); overflow-y: auto;" aria-label="Multimodal Zettel Vault">
          <div class="nf-badge-popover-header">
            <span class="nf-badge-pill">⚛ Multimodal Zettel Vault</span>
            <button class="nf-btn" id="btn-vault-close" title="Close Vault">✕</button>
          </div>
          <div id="zettel-vault-content" class="nf-badge-popover-message">
            No symbol-marked keywords yet. Circle, underline, or #tag a concept on the canvas!
          </div>
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

        <!-- Floating 6-Slot Radial Tool Wheel (Appears at 1-Finger Hold Anchor) -->
        <div id="radial-wheel-overlay" class="nf-radial-wheel" aria-hidden="true">
          <div class="nf-radial-center">HOLD<br/>WHEEL</div>
          <button class="nf-radial-slice nf-tool-active" data-radial-tool="fountain_pen" style="left: 90px; top: 24px;">
            <span>✒️</span><span>Pen</span>
          </button>
          <button class="nf-radial-slice" data-radial-tool="felt_tip_marker" style="left: 147px; top: 57px;">
            <span>🖍️</span><span>Mark</span>
          </button>
          <button class="nf-radial-slice" data-radial-tool="ai_highlighter" style="left: 147px; top: 123px;">
            <span>✨</span><span>AI</span>
          </button>
          <button class="nf-radial-slice" data-radial-tool="freehand_lasso" style="left: 90px; top: 156px;">
            <span>➰</span><span>Lasso</span>
          </button>
          <button class="nf-radial-slice" data-radial-tool="stroke_eraser" style="left: 33px; top: 123px;">
            <span>✂️</span><span>Slice</span>
          </button>
          <button class="nf-radial-slice" data-radial-tool="pan_laser" style="left: 33px; top: 57px;">
            <span>🔴</span><span>Laser</span>
          </button>
        </div>

        <!-- AI Status Badge Inspection Popover -->
        <div id="badge-popover-overlay" class="nf-badge-popover" role="dialog" aria-label="AI Badge Details">
          <div class="nf-badge-popover-header">
            <span class="nf-badge-pill" id="badge-popover-status-pill">verified</span>
            <button class="nf-btn" id="btn-popover-close" title="Close Popover">✕</button>
          </div>
          <div class="nf-badge-popover-message" id="badge-popover-message">
            Claim & spatial cluster verified.
          </div>
          <button class="nf-action-btn" id="btn-popover-spawn-zettel">
            ⚛ Synthesize Linked Zettel Card
          </button>
        </div>
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

  private getCanvasScreenPoint(clientX: number, clientY: number): ScreenPoint {
    const rect = this.wetCanvas.getBoundingClientRect();
    return screenPoint(clientX - rect.left, clientY - rect.top);
  }

  public selectTool(tool: RadialToolSlot): void {
    this.store.selectRadialTool(tool);
    this.pinnedRadialAnchor = null;
    this.syncToolSelection();
    this.syncSwatchSelection();
    this.updateHudState();
  }

  private bindPointerEvents(): void {
    this.wetCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      const tapPt = this.getCanvasScreenPoint(e.clientX, e.clientY);

      if (this.pinnedRadialAnchor !== null) {
        const sliceTool = hitTestRadialWheelSlice(
          this.pinnedRadialAnchor,
          tapPt
        );
        this.pinnedRadialAnchor = null;
        if (sliceTool !== null) {
          this.selectTool(sliceTool);
          return;
        }
      }

      const hitBadge = this.store.hitTestBadgeAtScreenPoint(
        tapPt,
        this.viewportWidth,
        this.viewportHeight
      );
      if (hitBadge) {
        this.pendingBadgeTap = { pointerId: e.pointerId, startPt: tapPt };
      } else {
        this.pendingBadgeTap = null;
        if (this.inspectedBadgeId !== null) {
          this.closeBadgePopover();
        }
      }
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
      if (
        this.pendingBadgeTap &&
        this.pendingBadgeTap.pointerId === e.pointerId
      ) {
        const movePt = this.getCanvasScreenPoint(e.clientX, e.clientY);
        if (
          Math.hypot(
            movePt.x - this.pendingBadgeTap.startPt.x,
            movePt.y - this.pendingBadgeTap.startPt.y
          ) > 8
        ) {
          this.pendingBadgeTap = null;
        }
      }
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
      const adapted = adaptDomPointerEvent(e);
      const endPt = this.getCanvasScreenPoint(e.clientX, e.clientY);

      if (
        this.pendingBadgeTap &&
        this.pendingBadgeTap.pointerId === e.pointerId
      ) {
        const tapDist = Math.hypot(
          endPt.x - this.pendingBadgeTap.startPt.x,
          endPt.y - this.pendingBadgeTap.startPt.y
        );
        this.pendingBadgeTap = null;
        if (tapDist <= 8) {
          this.bridge.handlePointerCancel(adapted);
          this.openBadgePopoverAtScreenPoint(endPt);
          this.updateHudState();
          return;
        }
      }

      if (
        this.bridge.gestureState === 'TOUCH_HOLD_MODIFIER' &&
        this.bridge.holdAnchor !== null
      ) {
        const anchor = this.bridge.holdAnchor;
        const sliceHit = hitTestRadialWheelSlice(anchor, endPt);
        if (sliceHit !== null) {
          this.selectTool(sliceHit);
        } else if (Math.hypot(endPt.x - anchor.x, endPt.y - anchor.y) < 24) {
          this.pinnedRadialAnchor = anchor;
        }
      }

      this.bridge.handlePointerUp(adapted);
      this.pumpBackgroundAiJobs();
      this.updateHudState();
    };

    this.wetCanvas.addEventListener('pointerup', handleEnd);
    this.wetCanvas.addEventListener('pointercancel', (e: PointerEvent) => {
      e.preventDefault();
      this.pendingBadgeTap = null;
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
          this.store.zoomCamera(
            this.getCanvasScreenPoint(e.clientX, e.clientY),
            zoomFactor
          );
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
    const toolButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-tool]');
    toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectTool(btn.dataset.tool as RadialToolSlot);
      });
    });

    const radialButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-radial-tool]');
    radialButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectTool(btn.dataset.radialTool as RadialToolSlot);
      });
    });

    // Badge Popover Close & Synthesize Linked Zettel Card buttons
    this.root.querySelector('#btn-popover-close')?.addEventListener('click', () => {
      this.closeBadgePopover();
    });
    this.root.querySelector('#btn-popover-spawn-zettel')?.addEventListener('click', () => {
      this.synthesizeZettelFromInspectedBadge();
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

    // Rotation lock / Undo / Redo / Reset Camera
    const rotationLockBtn =
      this.root.querySelector<HTMLButtonElement>('#btn-rotation-lock');
    rotationLockBtn?.addEventListener('click', () => {
      const nextLocked = !this.store.rotationLocked;
      this.store.setRotationLocked(nextLocked);
      rotationLockBtn.textContent = nextLocked
        ? '🔒 Rotate: OFF'
        : '🔓 Rotate: ON';
      this.updateHudState();
    });
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
      this.store.rotateCamera(0);
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
    this.root.querySelector('#btn-toggle-vault')?.addEventListener('click', () => {
      const drawer = this.root.querySelector<HTMLElement>('#zettel-vault-drawer');
      if (drawer) {
        this.store.syncZettelkastenNow();
        drawer.classList.toggle('nf-badge-popover-visible');
        this.syncVaultDrawerDom();
        this.scheduleDryRender();
      }
    });
    this.root.querySelector('#btn-vault-close')?.addEventListener('click', () => {
      this.root
        .querySelector<HTMLElement>('#zettel-vault-drawer')
        ?.classList.remove('nf-badge-popover-visible');
    });
    this.root.querySelector('#btn-reset-vault')?.addEventListener('click', () => {
      void this.resetVaultAndReseed();
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

  private syncToolSelection(): void {
    const activeTool = this.store.activeTool;
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-tool]')
      .forEach((b) =>
        b.classList.toggle('nf-tool-active', b.dataset.tool === activeTool)
      );
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-radial-tool]')
      .forEach((b) =>
        b.classList.toggle(
          'nf-tool-active',
          b.dataset.radialTool === activeTool
        )
      );
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
          if (advanceBackgroundJobPhase(this.store, badge.id, 'running')) {
            this.scheduleDryRender();
          }
        }, 350);

        // Transition `↻` (running) -> `●` (completed) after 1100ms
        setTimeout(() => {
          if (advanceBackgroundJobPhase(this.store, badge.id, 'completed')) {
            this.scheduleDryRender();
          }
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

  public openBadgePopoverAtScreenPoint(pt: ScreenPoint): ProjectedJobBadge | null {
    const hit = this.store.hitTestBadgeAtScreenPoint(
      pt,
      this.viewportWidth,
      this.viewportHeight
    );
    if (!hit) {
      this.closeBadgePopover();
      return null;
    }

    this.inspectedBadgeId = hit.id;
    this.syncBadgePopoverDom(hit);
    return hit;
  }

  public closeBadgePopover(): void {
    this.inspectedBadgeId = null;
    const popoverEl = this.root.querySelector<HTMLElement>(
      '#badge-popover-overlay'
    );
    popoverEl?.classList.remove('nf-badge-popover-visible');
  }

  public synthesizeZettelFromInspectedBadge(): boolean {
    if (!this.inspectedBadgeId) return false;
    const zettelNodeId = synthesizeZettelForBadge(
      this.store,
      this.zettelRepo,
      this.inspectedBadgeId
    );
    if (!zettelNodeId) {
      this.updateHudState();
      return false;
    }

    this.closeBadgePopover();
    this.scheduleDryRender();
    this.updateHudState();
    return true;
  }

  private syncBadgePopoverDom(badge: ProjectedJobBadge): void {
    const popoverEl = this.root.querySelector<HTMLElement>(
      '#badge-popover-overlay'
    );
    if (!popoverEl) return;

    const pillEl = this.root.querySelector<HTMLElement>(
      '#badge-popover-status-pill'
    );
    const msgEl = this.root.querySelector<HTMLElement>(
      '#badge-popover-message'
    );
    const spawnBtn = this.root.querySelector<HTMLButtonElement>(
      '#btn-popover-spawn-zettel'
    );

    const badgeState =
      typeof badge.resultJson?.badgeState === 'string'
        ? badge.resultJson.badgeState
        : badge.status;
    const tooltipMessage =
      typeof badge.resultJson?.tooltipMessage === 'string'
        ? badge.resultJson.tooltipMessage
        : badge.status === 'queued'
          ? '◌ Queued for background verification...'
          : badge.status === 'running'
            ? '↻ Analysing spatial stroke cluster...'
            : '● Claim & spatial cluster verified.';
    const linkedZettelId =
      typeof badge.resultJson?.linkedZettelId === 'string'
        ? badge.resultJson.linkedZettelId
        : null;
    const alreadySynthesized =
      linkedZettelId !== null &&
      this.store.nodeRepo.getById(nodeId(linkedZettelId)) !== null;

    if (pillEl) pillEl.textContent = `${badge.status} • ${badgeState}`;
    if (msgEl) msgEl.textContent = tooltipMessage;
    if (spawnBtn) {
      spawnBtn.disabled = alreadySynthesized;
      spawnBtn.textContent = alreadySynthesized
        ? '✓ Linked Zettel Synthesized'
        : '⚛ Synthesize Linked Zettel Card';
    }

    const left = Math.min(
      Math.max(16, Math.round(badge.screenX + 20)),
      Math.max(16, this.viewportWidth - 284)
    );
    const top = Math.min(
      Math.max(72, Math.round(badge.screenY - 24)),
      Math.max(72, this.viewportHeight - 160)
    );
    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${top}px`;
    popoverEl.classList.add('nf-badge-popover-visible');
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

    // Floating Radial Tool Wheel visibility & coordinates at 1-finger hold anchor or pinned summon anchor
    const wheelEl = this.root.querySelector<HTMLElement>(
      '#radial-wheel-overlay'
    );
    if (wheelEl) {
      const activeAnchor =
        this.bridge.gestureState === 'TOUCH_HOLD_MODIFIER' &&
        this.bridge.holdAnchor !== null
          ? this.bridge.holdAnchor
          : this.pinnedRadialAnchor;
      if (activeAnchor !== null) {
        wheelEl.style.left = `${Math.round(activeAnchor.x)}px`;
        wheelEl.style.top = `${Math.round(activeAnchor.y)}px`;
        wheelEl.classList.add('nf-radial-wheel-visible');
      } else {
        wheelEl.classList.remove('nf-radial-wheel-visible');
      }
    }

    // Keep inspected badge popover synced (or close if badge was removed/hidden)
    if (this.inspectedBadgeId !== null) {
      const frame = this.store.buildSceneFrame(
        this.viewportWidth,
        this.viewportHeight
      );
      const currentBadge = frame.badges.find(
        (b) => b.id === this.inspectedBadgeId
      );
      if (currentBadge) {
        this.syncBadgePopoverDom(currentBadge);
      } else {
        this.closeBadgePopover();
      }
    }

    this.syncVaultDrawerDom();
  }

  public syncVaultDrawerDom(): void {
    const contentEl = this.root.querySelector<HTMLElement>(
      '#zettel-vault-content'
    );
    if (!contentEl) return;

    const zettels = this.zettelRepo.getAllZettels();
    const blocks = this.zettelRepo.getCanvasBlocks(this.store.canvasId);
    const keywords = this.zettelRepo.getZettelKeywords(this.store.canvasId);
    const tasks = this.zettelRepo.getAgendaTasks(this.store.canvasId);

    const boundBlockIds = new Set<string>(keywords.map((k) => k.canvasBlockId));
    for (const z of zettels) {
      for (const ev of this.zettelRepo.getEvidenceLinksForZettel(z.id)) {
        boundBlockIds.add(ev.blockId);
      }
    }
    const unboundBlocks = blocks.filter((b) => !boundBlockIds.has(b.id));

    const zettelItems = zettels
      .map(
        (z) =>
          `<div style="margin-bottom:8px;padding:6px;border-radius:8px;background:rgba(239,246,255,0.85);">
            <strong>⚛ ${z.title}</strong> (${z.verificationState})<br/>
            <span style="font-size:11px;white-space:pre-line;">${z.summaryMarkdown}</span>
          </div>`
      )
      .join('');

    const unboundItems = unboundBlocks
      .map(
        (b) =>
          `<div style="font-size:11px;margin-bottom:4px;opacity:0.85;">• [${b.modality}] ${b.rawText}</div>`
      )
      .join('');

    const taskItems = tasks
      .map(
        (t) =>
          `<div style="font-size:11px;margin-bottom:4px;">${t.completed ? '☑' : '☐'} ${t.taskText} ${t.dueDateIso ? `(@${t.dueDateIso})` : ''}</div>`
      )
      .join('');

    contentEl.innerHTML = `
      <div><strong>Atomic Zettels (${zettels.length})</strong></div>
      ${zettelItems || '<div style="font-size:11px;opacity:0.7;margin-bottom:8px;">None promoted yet</div>'}
      <div style="margin-top:8px;"><strong>Fleeting / Unbound Blocks (${unboundBlocks.length})</strong></div>
      ${unboundItems || '<div style="font-size:11px;opacity:0.7;margin-bottom:8px;">All blocks bound</div>'}
      <div style="margin-top:8px;"><strong>Agenda Tasks (${tasks.length})</strong></div>
      ${taskItems || '<div style="font-size:11px;opacity:0.7;">No tasks</div>'}
    `;
  }
}

export const RADIAL_WHEEL_SLICE_OFFSETS: ReadonlyArray<{
  readonly tool: RadialToolSlot;
  readonly dx: number;
  readonly dy: number;
}> = [
  { tool: 'fountain_pen', dx: 0, dy: -66 },
  { tool: 'felt_tip_marker', dx: 57, dy: -33 },
  { tool: 'ai_highlighter', dx: 57, dy: 33 },
  { tool: 'freehand_lasso', dx: 0, dy: 66 },
  { tool: 'stroke_eraser', dx: -57, dy: 33 },
  { tool: 'pan_laser', dx: -57, dy: -33 },
];

/**
 * Polar hit-testing for the 6-slot Radial Tool Wheel relative to `anchor`.
 * Supports both Hold-Slide-Release marking menu gestures and sticky-wheel slice taps.
 */
export function hitTestRadialWheelSlice(
  anchor: ScreenPoint,
  cursor: ScreenPoint,
  minRadius: number = 24,
  maxRadius: number = 115
): RadialToolSlot | null {
  const dx = cursor.x - anchor.x;
  const dy = cursor.y - anchor.y;
  const dist = Math.hypot(dx, dy);
  if (dist < minRadius || dist > maxRadius) return null;

  let bestTool: RadialToolSlot | null = null;
  let bestDistSq = Infinity;
  for (const slice of RADIAL_WHEEL_SLICE_OFFSETS) {
    const sdx = dx - slice.dx;
    const sdy = dy - slice.dy;
    const dSq = sdx * sdx + sdy * sdy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestTool = slice.tool;
    }
  }
  return bestTool;
}

/**
 * Synthesizes an Atomic Zettel Card anchored to `badgeId` via `CreateZettelCardCommand`
 * and records `linkedZettelId` in the badge's `resultJson` so duplicate clicks are idempotent.
 */
export function synthesizeZettelForBadge(
  store: CanvasStore,
  zettelRepo: ZettelRepository,
  badgeId: JobId
): NodeId | null {
  const badge = store.jobRepo.getBadgeById(badgeId);
  if (!badge) return null;
  const existingLinkedId =
    typeof badge.resultJson?.linkedZettelId === 'string'
      ? badge.resultJson.linkedZettelId
      : null;
  if (
    existingLinkedId !== null &&
    store.nodeRepo.getById(nodeId(existingLinkedId)) !== null
  ) {
    return null;
  }

  const aiLayer = store.getLayerByType('ai_feedback');
  const tooltipMessage =
    typeof badge.resultJson?.tooltipMessage === 'string'
      ? badge.resultJson.tooltipMessage
      : 'Synthesized from verified handwritten cluster.';
  const rawBadgeState = badge.resultJson?.badgeState;
  const verificationState =
    rawBadgeState === 'conflict'
      ? 'conflict'
      : rawBadgeState === 'hint_available'
        ? 'hint'
        : badge.status === 'completed'
          ? 'verified'
          : 'unverified';

  const validatedInput = CreateZettelCardToolSchema.parse({
    anchorClusterId: badge.anchorNodeId,
    title: 'Verified Claim Synthesis',
    summaryMarkdown: tooltipMessage,
    latexBlocks: [],
    verificationState,
    worldPosition: {
      x: Math.round(badge.anchorX + 24),
      y: Math.round(badge.anchorY - 12),
    },
  });

  const cmd = new CreateZettelCardCommand(store.db, store.nodeRepo, zettelRepo, {
    canvasId: store.canvasId,
    layerId: aiLayer.id,
    toolInput: validatedInput,
    embedding: null,
  });
  store.history.execute(cmd);
  const createdCardId = cmd.affectedNodeIds[0]!;

  store.jobRepo.updateJobStatus(badge.id, badge.status, {
    ...(badge.resultJson ?? {}),
    linkedZettelId: createdCardId,
  });

  return createdCardId;
}

/**
 * Advances an enqueued AI job badge through its runtime lifecycle (`queued` -> `running` -> `completed`)
 * using strict `UpdateJobBadgeToolSchema` validation on completion.
 */
export function advanceBackgroundJobPhase(
  store: CanvasStore,
  targetJobId: JobId,
  phase: 'running' | 'completed'
): boolean {
  const current = store.jobRepo.getBadgeById(targetJobId);
  if (!current) return false;

  if (phase === 'running') {
    return store.jobQueue.markJobRunning(targetJobId) !== null;
  }

  const completedUpdate = UpdateJobBadgeToolSchema.parse({
    jobId: targetJobId,
    status: 'completed',
    badgeState: 'verified',
    tooltipMessage: 'Claim & spatial cluster verified.',
  });
  return store.jobQueue.applyToolUpdate(completedUpdate);
}

export function bootstrapTabletApp(): NoteFlowTabletApp | null {
  if (typeof document === 'undefined') return null;
  const root = document.getElementById('app');
  if (!root) return null;
  return new NoteFlowTabletApp(root);
}

bootstrapTabletApp();
