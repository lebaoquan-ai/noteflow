export const MAX_WET_STROKE_POINTS = 16384;
export const MAX_PREDICTED_POINTS = 64;

export interface PointerSampleEvent {
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly pressure: number;
  readonly timeStamp: number;
  readonly getCoalescedEvents?: () => readonly PointerSampleEvent[];
  readonly getPredictedEvents?: () => readonly PointerSampleEvent[];
}

/**
 * Zero-allocation pre-allocated Float32Array ring/slab buffer for the <4ms
 * Ephemeral Wet-Ink Overlay (`docs/SPEC.md` §4 & `wet-dry-ink-pipeline` skill).
 * Each sample occupies 4 floats: [x, y, pressure, timestamp].
 */
export class WetStrokeBuffer {
  public readonly committedData = new Float32Array(MAX_WET_STROKE_POINTS * 4);
  public readonly predictedData = new Float32Array(MAX_PREDICTED_POINTS * 4);
  public committedCount = 0;
  public predictedCount = 0;

  public reset(): void {
    this.committedCount = 0;
    this.predictedCount = 0;
  }

  public appendCommitted(
    x: number,
    y: number,
    pressure: number,
    timestamp: number
  ): void {
    if (this.committedCount >= MAX_WET_STROKE_POINTS) return;
    const offset = this.committedCount * 4;
    this.committedData[offset] = x;
    this.committedData[offset + 1] = y;
    this.committedData[offset + 2] = pressure;
    this.committedData[offset + 3] = timestamp;
    this.committedCount++;
  }

  public clearPredicted(): void {
    this.predictedCount = 0;
  }

  public appendPredicted(
    x: number,
    y: number,
    pressure: number,
    timestamp: number
  ): void {
    if (this.predictedCount >= MAX_PREDICTED_POINTS) return;
    const offset = this.predictedCount * 4;
    this.predictedData[offset] = x;
    this.predictedData[offset + 1] = y;
    this.predictedData[offset + 2] = pressure;
    this.predictedData[offset + 3] = timestamp;
    this.predictedCount++;
  }

  /**
   * Exports a compact Float32Array copy of ONLY the committed points on pen-up
   * for persistence to SQLite (predicted points are never persisted).
   */
  public exportCommittedCopy(): Float32Array {
    return this.committedData.slice(0, this.committedCount * 4);
  }
}

export function normalizePressure(e: PointerSampleEvent): number {
  if (e.pointerType === 'pen') {
    return e.pressure > 0 ? e.pressure : 0.5;
  }
  return 0.5;
}

/**
 * Ingests high-frequency 120Hz/240Hz coalesced stylus samples and 1-2 frame
 * predicted look-ahead samples without allocating per-sample objects.
 */
export function ingestPointerMove(
  e: PointerSampleEvent,
  buffer: WetStrokeBuffer
): void {
  const coalesced = e.getCoalescedEvents?.() ?? [e];
  for (let i = 0; i < coalesced.length; i++) {
    const pt = coalesced[i]!;
    buffer.appendCommitted(
      pt.clientX,
      pt.clientY,
      normalizePressure(pt),
      pt.timeStamp
    );
  }

  buffer.clearPredicted();
  const predicted = e.getPredictedEvents?.() ?? [];
  for (let i = 0; i < predicted.length; i++) {
    const pt = predicted[i]!;
    buffer.appendPredicted(
      pt.clientX,
      pt.clientY,
      normalizePressure(pt),
      pt.timeStamp
    );
  }
}
