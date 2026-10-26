import type { UnifiedSceneFrame } from '../../state/canvas_store.js';
import { SEMANTIC_COLOR_HEX } from './canvas_renderer.js';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Phase 3 Artboard Vector Exporter (`docs/SPEC.md` §3.2 & §7):
 * Exports the visible Unified Scene Frame (respecting Teaching Mode layer
 * visibility) as a self-contained SVG Artboard ready for lecture slides or PDF print.
 */
export function exportCanvasArtboardSvg(
  frame: UnifiedSceneFrame,
  title: string = 'NoteFlow Artboard'
): string {
  const [minX, minY, maxX, maxY] = frame.worldViewport;
  const width = Math.max(100, Math.round(maxX - minX));
  const height = Math.max(100, Math.round(maxY - minY));

  const elements: string[] = [];

  for (const node of frame.visibleNodes) {
    if (node.nodeType === 'vector_stroke' && node.strokePoints) {
      const count = Math.floor(node.strokePoints.length / 4);
      if (count === 0) continue;
      const style = node.style ?? {
        colorId: 'noir',
        width: 2.8,
        brushType: 'pen',
      };
      const strokeHex = SEMANTIC_COLOR_HEX[style.colorId];
      const opacity =
        style.brushType === 'highlighter'
          ? 0.28
          : style.brushType === 'marker'
            ? 0.78
            : 1.0;

      const dParts: string[] = [];
      for (let i = 0; i < count; i++) {
        const x = node.strokePoints[i * 4]!.toFixed(2);
        const y = node.strokePoints[i * 4 + 1]!.toFixed(2);
        dParts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
      }

      elements.push(
        `  <path data-node-id="${escapeXml(node.id)}" d="${dParts.join(' ')}" fill="none" stroke="${strokeHex}" stroke-width="${style.width}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity}" />`
      );
    } else if (node.nodeType === 'zettel_card') {
      const [bx0, by0, bx1, by1] = node.bbox;
      const w = bx1 - bx0;
      const h = by1 - by0;
      const cardTitle = String(node.contentJson?.title ?? 'Zettel');
      const summary = String(node.contentJson?.summaryMarkdown ?? '');
      elements.push(
        `  <g data-node-id="${escapeXml(node.id)}" data-node-type="zettel_card">`,
        `    <rect x="${bx0}" y="${by0}" width="${w}" height="${h}" rx="6" fill="#FFFFFF" stroke="#7C3AED" stroke-width="2" />`,
        `    <text x="${bx0 + 10}" y="${by0 + 20}" font-family="system-ui, sans-serif" font-size="12" font-weight="bold" fill="#5B21B6">${escapeXml(cardTitle)}</text>`,
        `    <text x="${bx0 + 10}" y="${by0 + 46}" font-family="system-ui, sans-serif" font-size="11" fill="#1E293B">${escapeXml(summary)}</text>`,
        `  </g>`
      );
    } else if (node.nodeType === 'math_block') {
      const [bx0, by0, bx1, by1] = node.bbox;
      const w = bx1 - bx0;
      const h = by1 - by0;
      const latex = String(node.contentJson?.latex ?? '');
      elements.push(
        `  <g data-node-id="${escapeXml(node.id)}" data-node-type="math_block">`,
        `    <rect x="${bx0}" y="${by0}" width="${w}" height="${h}" rx="4" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="1.5" />`,
        `    <text x="${bx0 + 10}" y="${by0 + h / 2 + 4}" font-family="Georgia, serif" font-size="13" font-style="italic" fill="#1E3A8A">${escapeXml(latex)}</text>`,
        `  </g>`
      );
    } else if (node.nodeType === 'media_item') {
      const [bx0, by0, bx1, by1] = node.bbox;
      const w = bx1 - bx0;
      const h = by1 - by0;
      const uri = String(node.contentJson?.sourcePdfUri ?? 'source.pdf');
      const excerpt = String(node.contentJson?.excerptText ?? '');
      elements.push(
        `  <g data-node-id="${escapeXml(node.id)}" data-node-type="media_item">`,
        `    <rect x="${bx0}" y="${by0}" width="${w}" height="${h}" rx="4" fill="#FFFBEB" stroke="#D97706" stroke-width="1.5" />`,
        `    <text x="${bx0 + 10}" y="${by0 + 18}" font-family="system-ui, sans-serif" font-size="11" font-weight="bold" fill="#92400E">${escapeXml(uri)}</text>`,
        `    <text x="${bx0 + 10}" y="${by0 + 42}" font-family="Georgia, serif" font-size="11" font-style="italic" fill="#1E293B">${escapeXml(excerpt)}</text>`,
        `  </g>`
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">`,
    `  <title>${escapeXml(title)}</title>`,
    `  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#FAF8F5" />`,
    ...elements,
    `</svg>`,
  ].join('\n');
}
