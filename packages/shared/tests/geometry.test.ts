import { describe, it, expect } from 'vitest';
import {
  simplifyPoints,
  splitFragmentBySize,
  splitPathAtTileBorders,
  catmullRomToBezier,
  LocalPoint,
  TilePosition,
  TILE_UNITS,
  MAX_POINTS,
} from '../src/index.js';

describe('geometry', () => {
  describe('simplifyPoints (Ramer-Douglas-Peucker)', () => {
    it('simplifies collinear points to endpoints', () => {
      const points: LocalPoint[] = [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 200 },
        { x: 300, y: 300 },
        { x: 400, y: 400 },
      ];
      const simplified = simplifyPoints(points, 2);
      expect(simplified).toHaveLength(2);
      expect(simplified[0]).toEqual({ x: 0, y: 0 });
      expect(simplified[1]).toEqual({ x: 400, y: 400 });
    });

    it('preserves vertices with perpendicular distance above epsilon', () => {
      const points: LocalPoint[] = [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 0 },
      ];
      const simplified = simplifyPoints(points, 10);
      expect(simplified).toHaveLength(3);
      expect(simplified[1]).toEqual({ x: 100, y: 100 });
    });
  });

  describe('splitFragmentBySize (Amendment 8 & SPEC Section 4)', () => {
    it('returns a single fragment when point count is <= 512', () => {
      const points: LocalPoint[] = Array.from({ length: 512 }, (_, i) => ({ x: i, y: i }));
      const fragments = splitFragmentBySize(points, 512);
      expect(fragments).toHaveLength(1);
      expect(fragments[0]).toHaveLength(512);
    });

    it('splits a fragment that exceeds 512 points into consecutive fragments sharing a point', () => {
      // 1000 points
      const count = 1000;
      const points: LocalPoint[] = Array.from({ length: count }, (_, i) => ({ x: i * 10, y: i * 10 }));

      const fragments = splitFragmentBySize(points, 512);
      // Fragment 0: points 0..511 (512 points)
      // Fragment 1: points 511..999 (489 points)
      expect(fragments).toHaveLength(2);
      expect(fragments[0]).toHaveLength(512);
      expect(fragments[1]).toHaveLength(489);

      // Verify consecutive fragments share the boundary point
      const lastOfFirst = fragments[0][fragments[0].length - 1];
      const firstOfSecond = fragments[1][0];
      expect(lastOfFirst).toEqual(firstOfSecond);
      expect(lastOfFirst).toEqual({ x: 5110, y: 5110 });

      // Verify no points are lost
      expect(fragments[0][0]).toEqual({ x: 0, y: 0 });
      expect(fragments[1][fragments[1].length - 1]).toEqual({ x: 9990, y: 9990 });
    });

    it('splits a fragment of 1200 points into three consecutive fragments sharing points', () => {
      const count = 1200;
      const points: LocalPoint[] = Array.from({ length: count }, (_, i) => ({ x: i, y: i }));

      const fragments = splitFragmentBySize(points, 512);
      expect(fragments).toHaveLength(3);
      expect(fragments[0]).toHaveLength(512);
      expect(fragments[1]).toHaveLength(512);
      expect(fragments[2]).toHaveLength(1200 - 511 - 511); // 178

      // Boundary points shared
      expect(fragments[0][511]).toEqual(fragments[1][0]);
      expect(fragments[1][511]).toEqual(fragments[2][0]);
    });
  });

  describe('splitPathAtTileBorders', () => {
    it('keeps a stroke inside a single tile without splitting', () => {
      const path: TilePosition[] = [
        { tileX: 0, tileY: 0, x: 1000, y: 1000 },
        { tileX: 0, tileY: 0, x: 2000, y: 2000 },
      ];
      const fragments = splitPathAtTileBorders(path);
      expect(fragments).toHaveLength(1);
      expect(fragments[0].tileX).toBe(0);
      expect(fragments[0].tileY).toBe(0);
      expect(fragments[0].points).toHaveLength(2);
    });

    it('splits a stroke crossing tile boundary and inserts shared border point', () => {
      // Stroke crossing from tile (0, 0) to tile (1, 0)
      const path: TilePosition[] = [
        { tileX: 0, tileY: 0, x: 60000, y: 30000 },
        { tileX: 1, tileY: 0, x: 5000, y: 30000 },
      ];
      const fragments = splitPathAtTileBorders(path);
      expect(fragments).toHaveLength(2);

      // First fragment on tile (0, 0)
      expect(fragments[0].tileX).toBe(0);
      expect(fragments[0].tileY).toBe(0);
      const lastPt0 = fragments[0].points[fragments[0].points.length - 1];
      expect(lastPt0.x).toBeGreaterThanOrEqual(65530);

      // Second fragment on tile (1, 0)
      expect(fragments[1].tileX).toBe(1);
      expect(fragments[1].tileY).toBe(0);
      const firstPt1 = fragments[1].points[0];
      expect(firstPt1.x).toBeLessThanOrEqual(10);
    });
  });

  describe('catmullRomToBezier', () => {
    it('creates cubic bezier segments connecting all points', () => {
      const points: LocalPoint[] = [
        { x: 0, y: 0 },
        { x: 100, y: 200 },
        { x: 300, y: 150 },
        { x: 400, y: 400 },
      ];
      const segments = catmullRomToBezier(points);
      expect(segments).toHaveLength(3);

      // First segment starts at points[0] and ends at points[1]
      expect(segments[0].p0).toEqual(points[0]);
      expect(segments[0].p1).toEqual(points[1]);

      // Continuity between segments
      expect(segments[0].p1).toEqual(segments[1].p0);
      expect(segments[1].p1).toEqual(segments[2].p0);
      expect(segments[2].p1).toEqual(points[3]);
    });
  });
});
