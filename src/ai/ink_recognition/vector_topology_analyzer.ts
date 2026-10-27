import type { SpatialNodeRecord } from '../../db/repositories/spatial_node_repository.js';
import type {
  BlockModality,
  ClusterAnalysisResult,
  ExtractedSigils,
  InkRecognitionPort,
  PointingArrowDetection,
  PromotedKeywordCandidate,
} from './recognition_port.js';

interface Point2D {
  readonly x: number;
  readonly y: number;
}

function extractPoints(stroke: SpatialNodeRecord): Point2D[] {
  const raw = stroke.strokePoints;
  if (!raw || raw.length < 4) return [];
  const count = Math.floor(raw.length / 4);
  const pts: Point2D[] = [];
  for (let i = 0; i < count; i++) {
    pts.push({
      x: raw[i * 4]!,
      y: raw[i * 4 + 1]!,
    });
  }
  return pts;
}

export function normalizeKeywordToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[@#!?]+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function tokenizeText(raw: string): string[] {
  const matches = raw.toLowerCase().match(/[a-z0-9_+#@-]{2,}/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

export function parseLexicalSigils(rawText: string): ExtractedSigils {
  const hashTags: string[] = [];
  const bangAxioms: string[] = [];
  const questionInquiries: string[] = [];
  const atEntities: string[] = [];
  const dueDatesIso: string[] = [];

  for (const m of rawText.matchAll(/#([A-Za-z0-9_-]+)/g)) {
    if (m[1]) hashTags.push(m[1]);
  }
  for (const m of rawText.matchAll(/(?:^|\s)!([A-Za-z0-9_-]+)/g)) {
    if (m[1]) bangAxioms.push(m[1]);
  }
  for (const m of rawText.matchAll(/(?:^|\s)\?([A-Za-z0-9_-]+)/g)) {
    if (m[1]) questionInquiries.push(m[1]);
  }
  for (const m of rawText.matchAll(/@(\d{4}-\d{2}-\d{2})\b/g)) {
    if (m[1]) dueDatesIso.push(m[1]);
  }
  for (const m of rawText.matchAll(/@([A-Za-z][A-Za-z0-9_-]*)\b/g)) {
    if (m[1]) atEntities.push(m[1]);
  }

  let checkboxState: 'none' | 'todo' | 'done' = 'none';
  if (/^\s*\[\s*\]/.test(rawText) || /\[\s*\]/.test(rawText)) {
    checkboxState = 'todo';
  } else if (/^\s*\[[xX✓✔]\]/.test(rawText) || /\[[xX✓✔]\]/.test(rawText)) {
    checkboxState = 'done';
  }

  const cleanText = rawText
    .replace(/^\s*\[[ xX✓✔]*\]\s*/g, '')
    .replace(/#[A-Za-z0-9_-]+/g, '')
    .replace(/(?:^|\s)![A-Za-z0-9_-]+/g, ' ')
    .replace(/(?:^|\s)\?[A-Za-z0-9_-]+/g, ' ')
    .replace(/@\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    hashTags,
    bangAxioms,
    questionInquiries,
    atEntities,
    dueDatesIso,
    checkboxState,
    cleanText,
  };
}

export function isClosedEnclosureLoop(stroke: SpatialNodeRecord): boolean {
  const pts = extractPoints(stroke);
  if (pts.length < 8) return false;
  const [minX, minY, maxX, maxY] = stroke.bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 30 || h < 16) return false;

  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const diag = Math.hypot(w, h);
  const closureDist = Math.hypot(last.x - first.x, last.y - first.y);
  if (closureDist > Math.max(28, diag * 0.32)) return false;

  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) {
    pathLen += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return pathLen >= 1.35 * (w + h);
}

export function detectPointingArrowStroke(
  stroke: SpatialNodeRecord
): PointingArrowDetection | null {
  if (stroke.ocrText && stroke.ocrText.trim().length > 0) return null;
  if (isClosedEnclosureLoop(stroke)) return null;

  const pts = extractPoints(stroke);
  if (pts.length < 4) return null;

  const tail = pts[0]!;
  let maxDist = 0;
  let tipIndex = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - tail.x, pts[i]!.y - tail.y);
    if (d >= maxDist) {
      maxDist = d;
      tipIndex = i;
    }
  }

  if (maxDist < 75 || tipIndex === 0) return null;
  const tip = pts[tipIndex]!;
  const ux = (tip.x - tail.x) / maxDist;
  const uy = (tip.y - tail.y) / maxDist;

  // Check if there are arrowhead barb points after (or right around) tipIndex
  // that pull back along the shaft direction by 6..48px while staying near the tip.
  let barbCount = 0;
  for (let i = tipIndex + 1; i < pts.length; i++) {
    const p = pts[i]!;
    const relX = p.x - tip.x;
    const relY = p.y - tip.y;
    const alongShaft = relX * ux + relY * uy; // negative means pulled back toward tail
    const perp = Math.abs(-relX * uy + relY * ux);
    if (alongShaft <= -5 && alongShaft >= -50 && perp >= 3 && perp <= 40) {
      barbCount++;
    }
  }

  if (barbCount === 0) return null;

  return {
    strokeId: stroke.id,
    tailX: tail.x,
    tailY: tail.y,
    tipX: tip.x,
    tipY: tip.y,
    confidence: Math.min(0.98, 0.8 + barbCount * 0.08),
  };
}

export function isHorizontalLineStroke(stroke: SpatialNodeRecord): boolean {
  if (stroke.ocrText && stroke.ocrText.trim().length > 0) return false;
  if (isClosedEnclosureLoop(stroke)) return false;
  if (detectPointingArrowStroke(stroke) !== null) return false;

  const [minX, minY, maxX, maxY] = stroke.bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  return w >= 45 && h <= 14 && w / Math.max(1, h) >= 4.5;
}

export function isVerticalLineStroke(stroke: SpatialNodeRecord): boolean {
  if (isClosedEnclosureLoop(stroke)) return false;
  const [minX, minY, maxX, maxY] = stroke.bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  return h >= 45 && w <= 16 && h / Math.max(1, w) >= 4.0;
}

function boxesIntersect(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export class VectorTopologyAnalyzer implements InkRecognitionPort {
  public detectPointingArrow(
    stroke: SpatialNodeRecord
  ): PointingArrowDetection | null {
    return detectPointingArrowStroke(stroke);
  }

  public analyzeCluster(
    cluster: SpatialNodeRecord,
    memberStrokes: readonly SpatialNodeRecord[]
  ): ClusterAnalysisResult {
    // 1. Collect OCR text from member strokes (excluding duplicate text on enclosure loops if already present)
    const textEntries: Array<{ stroke: SpatialNodeRecord; text: string }> = [];
    for (const s of memberStrokes) {
      const t = s.ocrText?.trim();
      if (t) {
        textEntries.push({ stroke: s, text: t });
      }
    }

    const uniqueTexts: string[] = [];
    for (const entry of textEntries) {
      if (
        !uniqueTexts.some(
          (existing) =>
            existing.toLowerCase().includes(entry.text.toLowerCase())
        )
      ) {
        uniqueTexts.push(entry.text);
      }
    }
    const rawText = uniqueTexts.join(' ').trim();
    const sigils = parseLexicalSigils(rawText);

    // 2. Detect topological gestures inside the cluster
    const loopStrokes = memberStrokes.filter(isClosedEnclosureLoop);
    const horizontalLines = memberStrokes.filter(isHorizontalLineStroke);
    const verticalLines = memberStrokes.filter(isVerticalLineStroke);

    // Check for intersecting H + V divider strokes (Comparison Table)
    let hasIntersectingGrid = false;
    for (const hLine of horizontalLines) {
      for (const vLine of verticalLines) {
        if (boxesIntersect(hLine.bbox, vLine.bbox)) {
          hasIntersectingGrid = true;
          break;
        }
      }
      if (hasIntersectingGrid) break;
    }

    // 3. Classify BlockModality
    let modality: BlockModality = 'prose_explanation';
    if (hasIntersectingGrid || rawText.includes('|')) {
      modality = 'comparison_table';
    } else if (rawText.length === 0) {
      modality = 'sketch_diagram';
    } else if (/(\$.*\$|[∑∫∇∂≈≠≤≥]|\\frac|\\sum)/.test(rawText)) {
      modality = 'math_expression';
    } else if (
      sigils.checkboxState !== 'none' ||
      /^\s*(\d+\.|[-*•])\s+/.test(rawText)
    ) {
      modality = 'ordered_list';
    }

    // 4. Identify underline / double-underline strokes beneath text-bearing strokes
    const textStrokes = memberStrokes.filter(
      (s) => s.ocrText && s.ocrText.trim().length > 0 && !isClosedEnclosureLoop(s)
    );
    const underlineCandidates =
      modality === 'comparison_table'
        ? []
        : horizontalLines.filter((hLine) => {
            const hMidY = (hLine.bbox[1] + hLine.bbox[3]) / 2;
            return textStrokes.some((ts) => {
              const overlapX =
                Math.min(hLine.bbox[2], ts.bbox[2]) -
                Math.max(hLine.bbox[0], ts.bbox[0]);
              return overlapX >= 20 && hMidY >= ts.bbox[1] - 4;
            });
          });

    // 5. Promote ONLY symbol-marked keywords
    const promotedKeywords: PromotedKeywordCandidate[] = [];
    const seenNormalized = new Set<string>();

    const addKeyword = (
      keywordText: string,
      markerType: PromotedKeywordCandidate['markerType'],
      gestureStrokeId: string | null,
      confidence: number
    ): void => {
      const cleaned = keywordText.trim();
      const norm = normalizeKeywordToken(cleaned);
      if (!cleaned || !norm || seenNormalized.has(norm)) return;
      seenNormalized.add(norm);
      promotedKeywords.push({
        keywordText: cleaned,
        normalizedKeyword: norm,
        markerType,
        gestureStrokeId,
        confidence,
      });
    };

    // 5A. Circle / Enclosure Loop
    for (const loop of loopStrokes) {
      let targetWord = loop.ocrText?.trim() ?? '';
      if (!targetWord) {
        // Extract first concept word from enclosed text strokes
        const enclosed = textStrokes.filter((ts) =>
          boxesIntersect(loop.bbox, ts.bbox)
        );
        const firstEnclosed = enclosed[0]?.ocrText?.trim() ?? '';
        targetWord = firstEnclosed.split(/\s+/)[0] ?? '';
      }
      if (targetWord) {
        addKeyword(targetWord, 'circle', loop.id, 0.94);
      }
    }

    // 5B. Double-Underline or Single-Underline
    if (underlineCandidates.length >= 2) {
      const sorted = [...underlineCandidates].sort(
        (a, b) => a.bbox[1] - b.bbox[1]
      );
      let isDouble = false;
      for (let i = 0; i < sorted.length - 1; i++) {
        const yGap = Math.abs(sorted[i + 1]!.bbox[1] - sorted[i]!.bbox[1]);
        if (yGap <= 18) {
          isDouble = true;
          break;
        }
      }
      const primaryText =
        sigils.cleanText || textStrokes[0]?.ocrText?.trim() || '';
      if (primaryText) {
        addKeyword(
          primaryText,
          isDouble ? 'double_underline' : 'underline',
          sorted[0]!.id,
          isDouble ? 0.96 : 0.88
        );
      }
    } else if (underlineCandidates.length === 1) {
      const primaryText =
        sigils.cleanText || textStrokes[0]?.ocrText?.trim() || '';
      if (primaryText) {
        addKeyword(primaryText, 'underline', underlineCandidates[0]!.id, 0.88);
      }
    }

    // 5C. Lexical Sigils (#Tag, !axiom, ?inquiry, @Entity)
    for (const tag of sigils.hashTags) {
      addKeyword(tag, 'hash_tag', null, 0.97);
    }
    if (sigils.bangAxioms.length > 0 && sigils.hashTags.length === 0) {
      const title =
        sigils.cleanText.split(/\s+/).slice(0, 3).join(' ') ||
        sigils.bangAxioms[0]!;
      addKeyword(title, 'bang_axiom', null, 0.92);
    }
    if (sigils.questionInquiries.length > 0 && sigils.hashTags.length === 0) {
      const title =
        sigils.cleanText.split(/\s+/).slice(0, 3).join(' ') ||
        sigils.questionInquiries[0]!;
      addKeyword(title, 'question_inquiry', null, 0.9);
    }
    for (const entity of sigils.atEntities) {
      addKeyword(entity, 'at_entity', null, 0.91);
    }

    const structuralMetadata: Record<string, unknown> = {
      strokeCount: memberStrokes.length,
      hasEnclosureLoop: loopStrokes.length > 0,
      underlineCount: underlineCandidates.length,
      hasIntersectingGrid,
      sigils,
    };

    return {
      clusterId: cluster.id,
      modality,
      rawText:
        rawText ||
        (modality === 'sketch_diagram'
          ? '[Freehand Sketch / Diagram]'
          : '[Comparison Table]'),
      normalizedTokens: tokenizeText(rawText),
      structuralMetadata,
      promotedKeywords,
      sigils,
      bbox: cluster.bbox,
    };
  }
}
