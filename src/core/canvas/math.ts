import {
  MAX_CAMERA_ZOOM,
  MIN_CAMERA_ZOOM,
  screenPoint,
  worldAABB,
  worldPoint,
  type CameraState,
  type ScreenPoint,
  type WorldAABB,
  type WorldPoint,
} from './types.js';

export const SNAP_ROTATION_THRESHOLD_RAD = (5 * Math.PI) / 180;

/**
 * Converts a point from Screen Space (clientX/Y) to Infinite World Space.
 */
export function screenToWorld(pt: ScreenPoint, camera: CameraState): WorldPoint {
  const dx = (pt.x - camera.panX) / camera.zoom;
  const dy = (pt.y - camera.panY) / camera.zoom;
  const cos = Math.cos(-camera.rotation);
  const sin = Math.sin(-camera.rotation);
  return worldPoint(dx * cos - dy * sin, dx * sin + dy * cos);
}

/**
 * Converts a point from Infinite World Space to Screen Space.
 */
export function worldToScreen(pt: WorldPoint, camera: CameraState): ScreenPoint {
  const cos = Math.cos(camera.rotation);
  const sin = Math.sin(camera.rotation);
  const rx = pt.x * cos - pt.y * sin;
  const ry = pt.x * sin + pt.y * cos;
  return screenPoint(rx * camera.zoom + camera.panX, ry * camera.zoom + camera.panY);
}

/**
 * Zooms the camera around a focal point in screen space so the world point
 * beneath the focal point remains stationary. Clamps zoom between 0.1 and 32.0.
 */
export function zoomAroundPoint(
  camera: CameraState,
  focal: ScreenPoint,
  zoomDeltaRatio: number
): CameraState {
  const nextZoom = Math.min(
    MAX_CAMERA_ZOOM,
    Math.max(MIN_CAMERA_ZOOM, camera.zoom * zoomDeltaRatio)
  );
  const scaleChange = nextZoom / camera.zoom;

  return {
    ...camera,
    zoom: nextZoom,
    panX: focal.x - (focal.x - camera.panX) * scaleChange,
    panY: focal.y - (focal.y - camera.panY) * scaleChange,
  };
}

/**
 * Updates camera rotation and snaps to 0 radians when within ±5 degrees.
 */
export function rotateCameraWithSnap(
  camera: CameraState,
  newRotationRad: number
): CameraState {
  const normalized = Math.atan2(Math.sin(newRotationRad), Math.cos(newRotationRad));
  const snapped =
    Math.abs(normalized) <= SNAP_ROTATION_THRESHOLD_RAD ? 0 : normalized;
  return {
    ...camera,
    rotation: snapped,
  };
}

/**
 * Computes the Axis-Aligned Bounding Box (AABB) of a flat [x, y, pressure, timestamp]
 * Float32Array stroke stream, expanded by max(strokeWidth / 2, 0.5) to prevent
 * zero-area degenerate bounding boxes on single taps.
 */
export function computeStrokeAABB(points: Float32Array, strokeWidth: number): WorldAABB {
  if (points.length < 2) {
    return worldAABB(0, 0, 0, 0);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i += 4) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const pad = Math.max(strokeWidth / 2, 0.5);
  return worldAABB(minX - pad, minY - pad, maxX + pad, maxY + pad);
}

function perpendicularDistance(
  pt: WorldPoint,
  lineStart: WorldPoint,
  lineEnd: WorldPoint
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const magSq = dx * dx + dy * dy;

  if (magSq < 1e-12) {
    return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
  }

  const u = ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / magSq;
  const clampedU = Math.max(0, Math.min(1, u));
  const projX = lineStart.x + clampedU * dx;
  const projY = lineStart.y + clampedU * dy;
  return Math.hypot(pt.x - projX, pt.y - projY);
}

/**
 * Ramer-Douglas-Peucker (RDP) polyline decimation.
 * Preserves first and last points and removes intermediate points within `epsilon`.
 */
export function simplifyPolylineRDP(
  points: readonly WorldPoint[],
  epsilon: number
): WorldPoint[] {
  if (points.length <= 2) {
    return [...points];
  }

  let maxDist = 0;
  let maxIdx = 0;
  const start = points[0]!;
  const end = points[points.length - 1]!;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPolylineRDP(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPolylineRDP(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

/**
 * Ray-casting point-in-polygon test for freehand lasso hit-testing.
 */
export function isPointInPolygon(
  pt: WorldPoint,
  polygon: readonly WorldPoint[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Returns true if two WorldAABBs overlap or touch.
 */
export function aabbIntersects(a: WorldAABB, b: WorldAABB): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
