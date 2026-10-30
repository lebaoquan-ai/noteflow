import type {
  SemanticColor,
  StrokeStyle,
} from '../../core/canvas/types.js';
import type { GestureState } from '../../state/gesture_fsm.js';
import type {
  RadialToolSlot,
  UnifiedSceneFrame,
} from '../../state/canvas_store.js';
import type { WetStrokeBuffer } from './wet_ink_buffer.js';

export const SEMANTIC_COLOR_HEX: Record<SemanticColor, string> = {
  noir: '#1C1B1F',
  cobalt: '#1D4ED8',
  crimson: '#DC2626',
  forest: '#15803D',
  amber: '#D97706',
  violet: '#7C3AED',
};

export interface Canvas2DContextLike {
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number
  ): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'bevel' | 'round' | 'miter';
  globalAlpha: number;
  font: string;
}

function drawSmoothFlatStroke(
  ctx: Canvas2DContextLike,
  flatPoints: Float32Array,
  pointCount: number,
  style: StrokeStyle,
  scaleFactor: number = 1.0,
  layerOpacity: number = 1.0
): void {
  if (pointCount === 0) return;

  ctx.save();
  ctx.strokeStyle = SEMANTIC_COLOR_HEX[style.colorId];
  ctx.fillStyle = SEMANTIC_COLOR_HEX[style.colorId];
  ctx.lineCap = style.brushType === 'highlighter' ? 'square' : 'round';
  ctx.lineJoin = 'round';
  const baseAlpha =
    style.brushType === 'highlighter'
      ? 0.28
      : style.brushType === 'marker'
        ? 0.78
        : 1.0;
  ctx.globalAlpha = baseAlpha * layerOpacity;

  if (pointCount === 1) {
    const x = flatPoints[0]!;
    const y = flatPoints[1]!;
    const p = flatPoints[2]!;
    const r = (style.width * (0.45 + 0.75 * p) * scaleFactor) / 2;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Highlighter uses a single continuous smooth path so overlapping segments never darken
  if (style.brushType === 'highlighter') {
    ctx.lineWidth = style.width * 2.4 * scaleFactor;
    ctx.beginPath();
    ctx.moveTo(flatPoints[0]!, flatPoints[1]!);
    for (let i = 1; i < pointCount - 1; i++) {
      const x1 = flatPoints[i * 4]!;
      const y1 = flatPoints[i * 4 + 1]!;
      const x2 = flatPoints[(i + 1) * 4]!;
      const y2 = flatPoints[(i + 1) * 4 + 1]!;
      ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
    }
    const lastIdx = (pointCount - 1) * 4;
    ctx.lineTo(flatPoints[lastIdx]!, flatPoints[lastIdx + 1]!);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Pressure-modulated quadratic Bezier segments for Fountain Pen & Sketch Marker
  let prevMidX = flatPoints[0]!;
  let prevMidY = flatPoints[1]!;

  for (let i = 1; i < pointCount; i++) {
    const prevIdx = (i - 1) * 4;
    const currIdx = i * 4;
    const x1 = flatPoints[prevIdx]!;
    const y1 = flatPoints[prevIdx + 1]!;
    const p1 = flatPoints[prevIdx + 2]!;
    const x2 = flatPoints[currIdx]!;
    const y2 = flatPoints[currIdx + 1]!;
    const p2 = flatPoints[currIdx + 2]!;

    const midX = i === pointCount - 1 ? x2 : (x1 + x2) / 2;
    const midY = i === pointCount - 1 ? y2 : (y1 + y2) / 2;
    const avgPressure = (p1 + p2) * 0.5;

    ctx.lineWidth = style.width * (0.45 + 0.85 * avgPressure) * scaleFactor;
    ctx.beginPath();
    ctx.moveTo(prevMidX, prevMidY);
    ctx.quadraticCurveTo(x1, y1, midX, midY);
    ctx.stroke();

    prevMidX = midX;
    prevMidY = midY;
  }

  ctx.restore();
}

export class DualCanvasRenderer {
  /**
   * Renders ONLY the active in-flight stroke on the top desynchronized Wet-Ink
   * overlay `<canvas>` in Screen Space (<2ms).
   */
  public renderWetOverlay(
    ctx: Canvas2DContextLike,
    width: number,
    height: number,
    wetBuffer: WetStrokeBuffer,
    style: StrokeStyle,
    cameraZoom: number,
    activeTool: RadialToolSlot,
    gestureState: GestureState
  ): void {
    ctx.clearRect(0, 0, width, height);
    if (wetBuffer.committedCount === 0) return;

    const isLasso =
      gestureState === 'TOUCH_HOLD_PEN_LASSOING' ||
      activeTool === 'freehand_lasso';

    if (isLasso) {
      ctx.save();
      ctx.strokeStyle = '#7C3AED';
      ctx.fillStyle = 'rgba(124, 58, 237, 0.08)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(wetBuffer.committedData[0]!, wetBuffer.committedData[1]!);
      for (let i = 1; i < wetBuffer.committedCount; i++) {
        ctx.lineTo(
          wetBuffer.committedData[i * 4]!,
          wetBuffer.committedData[i * 4 + 1]!
        );
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (activeTool === 'stroke_eraser') {
      ctx.save();
      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 3.0;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(wetBuffer.committedData[0]!, wetBuffer.committedData[1]!);
      for (let i = 1; i < wetBuffer.committedCount; i++) {
        ctx.lineTo(
          wetBuffer.committedData[i * 4]!,
          wetBuffer.committedData[i * 4 + 1]!
        );
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (activeTool === 'pan_laser') {
      drawSmoothFlatStroke(
        ctx,
        wetBuffer.committedData,
        wetBuffer.committedCount,
        { colorId: 'crimson', width: 4.2, brushType: 'pen' },
        1.0
      );
      return;
    }

    // 1. Committed wet points in screen space
    drawSmoothFlatStroke(
      ctx,
      wetBuffer.committedData,
      wetBuffer.committedCount,
      style,
      cameraZoom
    );

    // 2. Predicted look-ahead tip from OS digitizer
    if (wetBuffer.predictedCount > 0 && wetBuffer.committedCount > 0) {
      const lastCommittedIdx = (wetBuffer.committedCount - 1) * 4;
      ctx.save();
      ctx.strokeStyle = SEMANTIC_COLOR_HEX[style.colorId];
      ctx.globalAlpha = style.brushType === 'highlighter' ? 0.2 : 0.65;
      ctx.lineWidth = style.width * 0.7 * cameraZoom;
      ctx.beginPath();
      ctx.moveTo(
        wetBuffer.committedData[lastCommittedIdx]!,
        wetBuffer.committedData[lastCommittedIdx + 1]!
      );
      for (let i = 0; i < wetBuffer.predictedCount; i++) {
        ctx.lineTo(
          wetBuffer.predictedData[i * 4]!,
          wetBuffer.predictedData[i * 4 + 1]!
        );
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Renders the Unified Dry Scene Graph (Grid + Dry Vector Strokes + Clusters +
   * Zettel Cards + PDF Citations + Lockstep Async Badges) on the bottom `<canvas>`.
   */
  public renderDrySceneGraph(
    ctx: Canvas2DContextLike,
    width: number,
    height: number,
    frame: UnifiedSceneFrame,
    selectedNodeIds: ReadonlySet<string> = new Set()
  ): void {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(frame.camera.panX, frame.camera.panY);
    ctx.scale(frame.camera.zoom, frame.camera.zoom);
    if (frame.camera.rotation !== 0) {
      ctx.rotate(frame.camera.rotation);
    }

    // 1. Subtle Infinite Dot Grid (enabled via Settings)
    if (frame.showGrid) {
      this.renderWorldDotGrid(ctx, frame);
    }

    // 2. Render Highlighters first (underneath pen ink)
    for (const node of frame.visibleNodes) {
      if (
        node.nodeType === 'vector_stroke' &&
        node.strokePoints &&
        node.style?.brushType === 'highlighter'
      ) {
        const layerOpacity = frame.layers?.get(node.layerId)?.opacity ?? 1.0;
        drawSmoothFlatStroke(
          ctx,
          node.strokePoints,
          Math.floor(node.strokePoints.length / 4),
          node.style,
          1.0,
          layerOpacity
        );
      }
    }

    // 3. Render Pen/Marker Strokes, Clusters, Zettel Cards, Media & Math Blocks
    for (const node of frame.visibleNodes) {
      const layerOpacity = frame.layers?.get(node.layerId)?.opacity ?? 1.0;

      if (
        node.nodeType === 'vector_stroke' &&
        node.strokePoints &&
        node.style?.brushType !== 'highlighter'
      ) {
        drawSmoothFlatStroke(
          ctx,
          node.strokePoints,
          Math.floor(node.strokePoints.length / 4),
          node.style ?? { colorId: 'noir', width: 2.8, brushType: 'pen' },
          1.0,
          layerOpacity
        );
      } else if (node.nodeType === 'stroke_cluster') {
        const isViolet = node.semanticTags.includes('violet');
        const promotedKeywords = Array.isArray(
          node.contentJson?.promotedKeywords
        )
          ? (node.contentJson.promotedKeywords as string[])
          : [];
        const hasPromoted = promotedKeywords.length > 0;
        ctx.save();
        ctx.globalAlpha = layerOpacity;
        ctx.strokeStyle = isViolet
          ? 'rgba(124, 58, 237, 0.45)'
          : hasPromoted
            ? 'rgba(29, 78, 216, 0.48)'
            : 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1.2 / frame.camera.zoom;
        ctx.setLineDash([4 / frame.camera.zoom, 4 / frame.camera.zoom]);
        ctx.strokeRect(
          node.bbox[0] - 4,
          node.bbox[1] - 4,
          node.bbox[2] - node.bbox[0] + 8,
          node.bbox[3] - node.bbox[1] + 8
        );
        if (hasPromoted) {
          ctx.setLineDash([]);
          const label = `⚛ ${promotedKeywords[0]}`;
          const chipW = Math.min(200, Math.max(64, label.length * 6.5 + 14));
          ctx.fillStyle = 'rgba(239, 246, 255, 0.94)';
          ctx.fillRect(node.bbox[0] - 4, node.bbox[1] - 22, chipW, 16);
          ctx.fillStyle = '#1D4ED8';
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.fillText(label, node.bbox[0] + 2, node.bbox[1] - 11);
        }
        ctx.restore();
      } else if (node.nodeType === 'zettel_card') {
        ctx.save();
        ctx.globalAlpha = layerOpacity;
        this.renderZettelCardNode(
          ctx,
          node.bbox,
          node.contentJson ?? {},
        );
        ctx.restore();
      } else if (node.nodeType === 'media_item') {
        ctx.save();
        ctx.globalAlpha = layerOpacity;
        this.renderPdfCitationNode(
          ctx,
          node.bbox,
          node.contentJson ?? {}
        );
        ctx.restore();
      } else if (node.nodeType === 'math_block') {
        ctx.save();
        ctx.globalAlpha = layerOpacity;
        this.renderMathBlockNode(
          ctx,
          node.bbox,
          node.contentJson ?? {}
        );
        ctx.restore();
      }

      if (selectedNodeIds.has(node.id)) {
        ctx.save();
        ctx.strokeStyle = '#7C3AED';
        ctx.lineWidth = 2.0 / frame.camera.zoom;
        ctx.setLineDash([5 / frame.camera.zoom, 3 / frame.camera.zoom]);
        ctx.strokeRect(
          node.bbox[0] - 6,
          node.bbox[1] - 6,
          node.bbox[2] - node.bbox[0] + 12,
          node.bbox[3] - node.bbox[1] + 12
        );
        ctx.restore();
      }
    }

    ctx.restore();

    // 4. Render Async Status Badges (`◌` -> `🔄` -> `●`) in screen space
    // using the exact same frame.camera projection so they never drift!
    for (const badge of frame.badges) {
      ctx.save();
      const bx = badge.screenX + 8;
      const by = badge.screenY - 8;

      const bgColor =
        badge.status === 'completed'
          ? '#15803D'
          : badge.status === 'running'
            ? '#7C3AED'
            : '#D97706';

      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.arc(bx, by, 13, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 11px system-ui, sans-serif';
      const label =
        badge.status === 'completed'
          ? '●'
          : badge.status === 'running'
            ? '↻'
            : '◌';
      ctx.fillText(label, bx - 4, by + 4);
      ctx.restore();
    }
  }

  private renderWorldDotGrid(
    ctx: Canvas2DContextLike,
    frame: UnifiedSceneFrame
  ): void {
    const spacing = 32;
    const [minX, minY, maxX, maxY] = frame.worldViewport;
    if (maxX - minX > 4000 || maxY - minY > 4000) return;

    const startX = Math.floor(minX / spacing) * spacing;
    const startY = Math.floor(minY / spacing) * spacing;

    ctx.save();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
    const dotSize = Math.max(1.2, 1.8 / frame.camera.zoom);
    for (let x = startX; x <= maxX; x += spacing) {
      for (let y = startY; y <= maxY; y += spacing) {
        ctx.fillRect(x, y, dotSize, dotSize);
      }
    }
    ctx.restore();
  }

  private renderZettelCardNode(
    ctx: Canvas2DContextLike,
    bbox: readonly [number, number, number, number],
    content: Record<string, unknown>
  ): void {
    const [minX, minY, maxX, maxY] = bbox;
    const w = maxX - minX;
    const h = maxY - minY;

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#7C3AED';
    ctx.lineWidth = 2;
    ctx.fillRect(minX, minY, w, h);
    ctx.strokeRect(minX, minY, w, h);

    ctx.fillStyle = '#F5F3FF';
    ctx.fillRect(minX, minY, w, 28);

    ctx.fillStyle = '#5B21B6';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(
      `⚛ ZETTEL: ${String(content.title ?? 'Atomic Note')}`,
      minX + 10,
      minY + 18,
      w - 20
    );

    ctx.fillStyle = '#1E293B';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(
      String(content.summaryMarkdown ?? ''),
      minX + 10,
      minY + 50,
      w - 20
    );

    const latexBlocks = Array.isArray(content.latexBlocks)
      ? content.latexBlocks
      : [];
    if (latexBlocks.length > 0) {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(minX + 10, minY + 68, w - 20, 32);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'italic 12px Georgia, serif';
      ctx.fillText(String(latexBlocks[0]), minX + 16, minY + 88, w - 32);
    }
    ctx.restore();
  }

  private renderPdfCitationNode(
    ctx: Canvas2DContextLike,
    bbox: readonly [number, number, number, number],
    content: Record<string, unknown>
  ): void {
    const [minX, minY, maxX, maxY] = bbox;
    const w = maxX - minX;
    const h = maxY - minY;

    ctx.save();
    ctx.fillStyle = '#FFFBEB';
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 2;
    ctx.fillRect(minX, minY, w, h);
    ctx.strokeRect(minX, minY, w, h);

    ctx.fillStyle = '#FEF3C7';
    ctx.fillRect(minX, minY, w, 26);

    ctx.fillStyle = '#92400E';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(
      `📄 PDF CITATION • p.${String(content.pageNumber ?? 1)} (${String(content.sourcePdfUri ?? 'source.pdf')})`,
      minX + 10,
      minY + 17,
      w - 20
    );

    ctx.fillStyle = '#1E293B';
    ctx.font = 'italic 12px Georgia, serif';
    ctx.fillText(
      `"${String(content.excerptText ?? '')}"`,
      minX + 10,
      minY + 52,
      w - 20
    );
    ctx.restore();
  }

  private renderMathBlockNode(
    ctx: Canvas2DContextLike,
    bbox: readonly [number, number, number, number],
    content: Record<string, unknown>
  ): void {
    const [minX, minY, maxX, maxY] = bbox;
    const w = maxX - minX;
    const h = maxY - minY;

    ctx.save();
    ctx.fillStyle = '#EFF6FF';
    ctx.strokeStyle = '#1D4ED8';
    ctx.lineWidth = 1.8;
    ctx.fillRect(minX, minY, w, h);
    ctx.strokeRect(minX, minY, w, h);

    ctx.fillStyle = '#1E3A8A';
    ctx.font = 'italic bold 14px Georgia, serif';
    ctx.fillText(
      `∑ LaTeX: ${String(content.latex ?? '')}`,
      minX + 12,
      minY + h / 2 + 5,
      w - 24
    );
    ctx.restore();
  }
}
