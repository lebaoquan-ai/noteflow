import { z } from 'zod';

declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };

export type CanvasId = Brand<string, 'CanvasId'>;
export type LayerId = Brand<string, 'LayerId'>;
export type NodeId = Brand<string, 'NodeId'>;
export type JobId = Brand<string, 'JobId'>;

export type ScreenPoint = Brand<{ readonly x: number; readonly y: number }, 'ScreenPoint'>;
export type WorldPoint = Brand<{ readonly x: number; readonly y: number }, 'WorldPoint'>;
export type WorldAABB = Brand<readonly [number, number, number, number], 'WorldAABB'>;

export function canvasId(id: string): CanvasId {
  return id as CanvasId;
}

export function layerId(id: string): LayerId {
  return id as LayerId;
}

export function nodeId(id: string): NodeId {
  return id as NodeId;
}

export function jobId(id: string): JobId {
  return id as JobId;
}

export function screenPoint(x: number, y: number): ScreenPoint {
  return { x, y } as ScreenPoint;
}

export function worldPoint(x: number, y: number): WorldPoint {
  return { x, y } as WorldPoint;
}

export function worldAABB(minX: number, minY: number, maxX: number, maxY: number): WorldAABB {
  return [minX, minY, maxX, maxY] as unknown as WorldAABB;
}

export const MIN_CAMERA_ZOOM = 0.1;
export const MAX_CAMERA_ZOOM = 32.0;

export const CameraStateSchema = z.object({
  panX: z.number().finite(),
  panY: z.number().finite(),
  zoom: z.number().min(MIN_CAMERA_ZOOM).max(MAX_CAMERA_ZOOM),
  rotation: z.number().finite(),
});

export type CameraState = z.infer<typeof CameraStateSchema>;

export const SemanticColorSchema = z.enum([
  'noir',
  'cobalt',
  'crimson',
  'forest',
  'amber',
  'violet',
]);

export type SemanticColor = z.infer<typeof SemanticColorSchema>;

export const BrushTypeSchema = z.enum(['pen', 'marker', 'highlighter']);

export type BrushType = z.infer<typeof BrushTypeSchema>;

export const StrokeStyleSchema = z.object({
  colorId: SemanticColorSchema,
  width: z.number().min(1.2).max(6.0),
  brushType: BrushTypeSchema,
});

export type StrokeStyle = z.infer<typeof StrokeStyleSchema>;

export const StrokeCommittedEventSchema = z.object({
  nodeId: z.string().uuid(),
  canvasId: z.string().uuid(),
  layerId: z.string().uuid(),
  bbox: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  points: z.instanceof(Float32Array),
  style: StrokeStyleSchema,
});

export type StrokeCommittedEvent = z.infer<typeof StrokeCommittedEventSchema>;
