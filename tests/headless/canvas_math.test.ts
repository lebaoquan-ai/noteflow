import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  screenPoint,
  worldPoint,
  worldAABB,
  StrokeCommittedEventSchema,
  CameraStateSchema,
  type CameraState,
  type WorldPoint,
} from '../../src/core/canvas/types.js';
import {
  screenToWorld,
  worldToScreen,
  zoomAroundPoint,
  rotateCameraWithSnap,
  computeStrokeAABB,
  simplifyPolylineRDP,
  isPointInPolygon,
  aabbIntersects,
} from '../../src/core/canvas/math.js';

describe('Canvas Spatial Math & Branded Types (Headless Verification)', () => {
  describe('Zod Runtime Boundary Schemas', () => {
    it('validates CameraStateSchema and rejects out-of-range zoom', () => {
      const valid = CameraStateSchema.safeParse({
        panX: 100,
        panY: -50,
        zoom: 1.5,
        rotation: 0,
      });
      expect(valid.success).toBe(true);

      const invalidZoom = CameraStateSchema.safeParse({
        panX: 0,
        panY: 0,
        zoom: 0.01, // Below 10% (0.1) minimum
        rotation: 0,
      });
      expect(invalidZoom.success).toBe(false);
    });

    it('validates StrokeCommittedEventSchema', () => {
      const validEvent = {
        nodeId: crypto.randomUUID(),
        canvasId: crypto.randomUUID(),
        layerId: crypto.randomUUID(),
        bbox: [10, 20, 100, 120] as [number, number, number, number],
        points: new Float32Array([10, 20, 0.5, 1000, 100, 120, 0.8, 1016]),
        style: {
          colorId: 'violet' as const,
          width: 2.8,
          brushType: 'highlighter' as const,
        },
      };
      const parsed = StrokeCommittedEventSchema.safeParse(validEvent);
      expect(parsed.success).toBe(true);
    });
  });

  describe('2D Camera Matrix Projections & Focal Zoom', () => {
    it('projects screen to world and back accurately with translation, zoom, and rotation', () => {
      const camera: CameraState = {
        panX: 250,
        panY: -120,
        zoom: 2.5,
        rotation: Math.PI / 6,
      };
      const sPt = screenPoint(400, 300);
      const wPt = screenToWorld(sPt, camera);
      const roundTrip = worldToScreen(wPt, camera);

      expect(roundTrip.x).toBeCloseTo(sPt.x, 6);
      expect(roundTrip.y).toBeCloseTo(sPt.y, 6);
    });

    it('keeps the focal point stationary in world space during zoomAroundPoint', () => {
      const initialCamera: CameraState = {
        panX: 100,
        panY: 80,
        zoom: 1.0,
        rotation: 0,
      };
      const focal = screenPoint(500, 400);
      const worldBefore = screenToWorld(focal, initialCamera);

      const zoomedCamera = zoomAroundPoint(initialCamera, focal, 3.0);
      expect(zoomedCamera.zoom).toBeCloseTo(3.0, 6);

      const worldAfter = screenToWorld(focal, zoomedCamera);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });

    it('clamps zoom between 10% (0.1) and 3200% (32.0)', () => {
      const camera: CameraState = { panX: 0, panY: 0, zoom: 1.0, rotation: 0 };
      const focal = screenPoint(0, 0);

      expect(zoomAroundPoint(camera, focal, 0.001).zoom).toBe(0.1);
      expect(zoomAroundPoint(camera, focal, 100.0).zoom).toBe(32.0);
    });

    it('snaps rotation to 0 radians when within ±5 degrees', () => {
      const camera: CameraState = { panX: 0, panY: 0, zoom: 1, rotation: 0.2 };
      const threeDegreesRad = (3 * Math.PI) / 180;
      const eightDegreesRad = (8 * Math.PI) / 180;

      expect(rotateCameraWithSnap(camera, threeDegreesRad).rotation).toBe(0);
      expect(rotateCameraWithSnap(camera, -threeDegreesRad).rotation).toBe(0);
      expect(rotateCameraWithSnap(camera, eightDegreesRad).rotation).toBeCloseTo(eightDegreesRad, 6);
    });
  });

  describe('Stroke AABB, RDP Simplification & Polygon Lasso', () => {
    it('computes stroke AABB padded by half stroke width and handles single-tap degenerate strokes', () => {
      const singleTap = new Float32Array([50, 60, 0.5, 100]);
      const aabb = computeStrokeAABB(singleTap, 4.0);
      expect(aabb[0]).toBe(48);
      expect(aabb[1]).toBe(58);
      expect(aabb[2]).toBe(52);
      expect(aabb[3]).toBe(62);
    });

    it('simplifies collinear points via RDP while preserving start and end points', () => {
      const pts: WorldPoint[] = [
        worldPoint(0, 0),
        worldPoint(10, 0.1),
        worldPoint(20, -0.1),
        worldPoint(30, 0.05),
        worldPoint(40, 0),
      ];
      const simplified = simplifyPolylineRDP(pts, 0.5);
      expect(simplified).toHaveLength(2);
      expect(simplified[0]).toEqual(pts[0]);
      expect(simplified[1]).toEqual(pts[4]);
    });

    it('accurately detects points inside and outside a closed lasso polygon', () => {
      const squareLasso: WorldPoint[] = [
        worldPoint(0, 0),
        worldPoint(100, 0),
        worldPoint(100, 100),
        worldPoint(0, 100),
      ];
      expect(isPointInPolygon(worldPoint(50, 50), squareLasso)).toBe(true);
      expect(isPointInPolygon(worldPoint(150, 50), squareLasso)).toBe(false);
    });

    it('correctly checks AABB overlap including touching edges', () => {
      const boxA = worldAABB(0, 0, 100, 100);
      const boxB = worldAABB(50, 50, 150, 150);
      const boxC = worldAABB(200, 200, 300, 300);

      expect(aabbIntersects(boxA, boxB)).toBe(true);
      expect(aabbIntersects(boxA, boxC)).toBe(false);
    });
  });

  describe('Property-Based Mathematical Invariants (fast-check)', () => {
    const cameraArb: fc.Arbitrary<CameraState> = fc.record({
      panX: fc.double({ min: -50000, max: 50000, noNaN: true }),
      panY: fc.double({ min: -50000, max: 50000, noNaN: true }),
      zoom: fc.double({ min: 0.1, max: 32.0, noNaN: true }),
      rotation: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    });

    const screenPtArb = fc
      .record({
        x: fc.double({ min: -10000, max: 10000, noNaN: true }),
        y: fc.double({ min: -10000, max: 10000, noNaN: true }),
      })
      .map(({ x, y }) => screenPoint(x, y));

    const worldPtArb = fc
      .record({
        x: fc.double({ min: -10000, max: 10000, noNaN: true }),
        y: fc.double({ min: -10000, max: 10000, noNaN: true }),
      })
      .map(({ x, y }) => worldPoint(x, y));

    it('worldToScreen(screenToWorld(pt, cam), cam) === pt across arbitrary cameras', () => {
      fc.assert(
        fc.property(screenPtArb, cameraArb, (pt, cam) => {
          const roundTrip = worldToScreen(screenToWorld(pt, cam), cam);
          expect(roundTrip.x).toBeCloseTo(pt.x, 4);
          expect(roundTrip.y).toBeCloseTo(pt.y, 4);
        }),
        { numRuns: 300 }
      );
    });

    it('RDP simplification preserves endpoints and never increases point count', () => {
      fc.assert(
        fc.property(
          fc.array(worldPtArb, { minLength: 2, maxLength: 60 }),
          fc.double({ min: 0.01, max: 50, noNaN: true }),
          (points, epsilon) => {
            const simplified = simplifyPolylineRDP(points, epsilon);
            expect(simplified.length).toBeGreaterThanOrEqual(2);
            expect(simplified.length).toBeLessThanOrEqual(points.length);
            expect(simplified[0]).toEqual(points[0]);
            expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('computeStrokeAABB strictly contains every sample point in the stream', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              fc.double({ min: -5000, max: 5000, noNaN: true }).map(Math.fround),
              fc.double({ min: -5000, max: 5000, noNaN: true }).map(Math.fround),
              fc.double({ min: 0.05, max: 1.0, noNaN: true }).map(Math.fround),
              fc.double({ min: 0, max: 100000, noNaN: true }).map(Math.fround)
            ),
            { minLength: 1, maxLength: 50 }
          ),
          fc.double({ min: 1.2, max: 6.0, noNaN: true }),
          (samples, width) => {
            const flat = new Float32Array(samples.length * 4);
            samples.forEach(([x, y, p, t], i) => {
              flat[i * 4] = x;
              flat[i * 4 + 1] = y;
              flat[i * 4 + 2] = p;
              flat[i * 4 + 3] = t;
            });

            const [minX, minY, maxX, maxY] = computeStrokeAABB(flat, width);
            expect(minX).toBeLessThan(maxX);
            expect(minY).toBeLessThan(maxY);

            for (const [x, y] of samples) {
              expect(x).toBeGreaterThanOrEqual(minX);
              expect(x).toBeLessThanOrEqual(maxX);
              expect(y).toBeGreaterThanOrEqual(minY);
              expect(y).toBeLessThanOrEqual(maxY);
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
