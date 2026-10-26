---
name: vector-ink-math
description: Mathematical algorithms and branded coordinate types for 2D camera matrices, coordinate projections, stroke polyline decimation, bounding boxes, and lasso geometry. Use whenever working on camera transformations, stroke simplifications, or spatial calculations.
---

# NoteFlow Vector Ink & Spatial Math Runbook

This skill provides verified mathematical formulas, pure algorithms, and compile-time branded coordinate types for NoteFlow's 2D canvas and ink pipeline.

## 1. Branded Spatial & Entity Types (Compile-Time Safety)

To prevent the most common spatial canvas bug—mixing raw DOM `ScreenPoint` (`clientX/Y`) with camera-projected `WorldPoint` (`worldX/Y`)—all coordinate functions MUST use branded types:

```typescript
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

// Entity UUID Brands (Always UUID strings in TS; NEVER expose SQLite integer rowid to JS)
export type CanvasId = Brand<string, 'CanvasId'>;
export type LayerId = Brand<string, 'LayerId'>;
export type NodeId = Brand<string, 'NodeId'>;
export type JobId = Brand<string, 'JobId'>;

// 2D Coordinate Space Brands
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly __space: 'screen';
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly __space: 'world';
}

export type WorldAABB = readonly [
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
] & { readonly __space: 'world' };

export function screenPoint(x: number, y: number): ScreenPoint {
  return { x, y, __space: 'screen' };
}

export function worldPoint(x: number, y: number): WorldPoint {
  return { x, y, __space: 'world' };
}

export function worldAABB(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): WorldAABB {
  return [minX, minY, maxX, maxY] as unknown as WorldAABB;
}
```

## 2. 2D Camera Matrix Transformations

The camera state defines the viewport: `panX`, `panY`, `zoom` (scale factor), and `rotation` (radians).

### Coordinate Conversions
```typescript
export interface CameraState {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;      // Clamped between 0.10 (10%) and 32.00 (3200%)
  readonly rotation: number;  // In radians. Snapped to 0 when |rotation| <= 0.087 rad (~5°)
}

// Convert screen viewport coordinates (touch/stylus) to world canvas coordinates
export function screenToWorld(
  pt: ScreenPoint,
  camera: CameraState
): WorldPoint {
  const dx = pt.x - camera.panX;
  const dy = pt.y - camera.panY;
  const cos = Math.cos(-camera.rotation);
  const sin = Math.sin(-camera.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return worldPoint(rx / camera.zoom, ry / camera.zoom);
}

// Convert world canvas coordinates to screen viewport coordinates
export function worldToScreen(
  pt: WorldPoint,
  camera: CameraState
): ScreenPoint {
  const cos = Math.cos(camera.rotation);
  const sin = Math.sin(camera.rotation);
  const zx = pt.x * camera.zoom;
  const zy = pt.y * camera.zoom;
  return screenPoint(
    zx * cos - zy * sin + camera.panX,
    zx * sin + zy * cos + camera.panY
  );
}
```

### Pinch-to-Zoom Around Focal Point
When zooming around touch midpoint `focal: ScreenPoint`:
```typescript
export function zoomAroundPoint(
  camera: CameraState,
  focal: ScreenPoint,
  zoomDeltaRatio: number
): CameraState {
  const newZoom = Math.min(Math.max(camera.zoom * zoomDeltaRatio, 0.1), 32.0);
  const factor = newZoom / camera.zoom;

  return {
    ...camera,
    zoom: newZoom,
    panX: focal.x - (focal.x - camera.panX) * factor,
    panY: focal.y - (focal.y - camera.panY) * factor,
  };
}
```

## 3. Stroke Point Stream & Bounding Box

Committed strokes store world coordinates in interleaved `Float32Array` buffers:
`[worldX0, worldY0, pressure0, timestamp0, worldX1, worldY1, pressure1, timestamp1, ...]` (stride = 4).

### Computing World Bounding Box (AABB)
```typescript
export function computeStrokeAABB(
  points: Float32Array,
  strokeWidth: number
): WorldAABB {
  if (points.length < 4) return worldAABB(0, 0, 0, 0);
  let minX = points[0];
  let maxX = points[0];
  let minY = points[1];
  let maxY = points[1];

  const stride = 4;
  for (let i = 0; i < points.length; i += stride) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Ensure degenerate single-tap strokes still have non-zero area via halfWidth
  const halfWidth = Math.max(strokeWidth / 2, 0.5);
  return worldAABB(
    minX - halfWidth,
    minY - halfWidth,
    maxX + halfWidth,
    maxY + halfWidth
  );
}
```

## 4. Ramer-Douglas-Peucker (RDP) Polyline Decimation

Reduces high-frequency 240Hz stylus samples while preserving visual curvature and handling collinear/coincident point edge cases:
```typescript
export function simplifyPolylineRDP(
  points: readonly WorldPoint[],
  epsilon: number
): WorldPoint[] {
  if (points.length <= 2) return [...points];

  let maxDistance = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], start, end);
    if (d > maxDistance) {
      index = i;
      maxDistance = d;
    }
  }

  if (maxDistance > epsilon) {
    const recResults1 = simplifyPolylineRDP(points.slice(0, index + 1), epsilon);
    const recResults2 = simplifyPolylineRDP(points.slice(index), epsilon);
    return recResults1.slice(0, -1).concat(recResults2);
  } else {
    return [start, end];
  }
}

function perpendicularDistance(
  p: WorldPoint,
  p1: WorldPoint,
  p2: WorldPoint
): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-9) return Math.hypot(p.x - p1.x, p.y - p1.y);
  return Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x) / mag;
}
```

## 5. Point-in-Polygon Raycasting (Magic Lasso Hit-Testing)

Tests whether a spatial node center `pt: WorldPoint` is enclosed inside a closed stylus lasso polygon in world space:
```typescript
export function isPointInPolygon(
  pt: WorldPoint,
  polygon: readonly WorldPoint[]
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
```
