import { LocalPoint, TilePosition, normalizeTileUnits } from './coordinates.js';
import { MAX_POINTS, TILE_UNITS } from './constants.js';

export interface StrokeFragment {
  tileX: number;
  tileY: number;
  points: LocalPoint[];
}

/**
 * Calculates perpendicular distance from point P to line segment (A, B).
 */
function perpendicularDistance(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const distSq = (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y);
    return Math.sqrt(distSq);
  }

  // Cross product / length
  const num = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
  return num / Math.sqrt(lenSq);
}

/**
 * Ramer-Douglas-Peucker (RDP) path simplification algorithm.
 * Operates in tile-local units.
 */
export function simplifyPoints(points: readonly LocalPoint[], epsilon: number): LocalPoint[] {
  if (points.length <= 2) {
    return [...points];
  }

  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;

  for (let i = 1; i < last; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[last]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, index + 1), epsilon);
    const right = simplifyPoints(points.slice(index), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [points[0], points[last]];
  }
}

/**
 * Splits a list of points into consecutive fragments of at most MAX_POINTS (512),
 * sharing boundary points between consecutive fragments.
 */
export function splitFragmentBySize(points: readonly LocalPoint[], maxPoints = MAX_POINTS): LocalPoint[][] {
  if (points.length <= maxPoints) {
    return [[...points]];
  }

  const fragments: LocalPoint[][] = [];
  let startIndex = 0;

  while (startIndex < points.length) {
    // Each fragment takes up to maxPoints
    const endIndex = Math.min(startIndex + maxPoints, points.length);
    const fragment = points.slice(startIndex, endIndex);
    fragments.push(fragment);

    if (endIndex >= points.length) {
      break;
    }
    // Consecutive fragments share a point
    startIndex = endIndex - 1;
  }

  return fragments;
}

/**
 * Represents a raw continuous pointer path with tile + offset coordinates.
 */
export interface RawPathPoint {
  tileX: number;
  tileY: number;
  x: number; // 0..65535 or beyond before split
  y: number; // 0..65535 or beyond before split
}

/**
 * Splits a continuous multi-tile stroke path at tile boundaries.
 * Inserts the border intersection point into both fragments so each tile owns whole strokes.
 */
export function splitPathAtTileBorders(rawPoints: readonly TilePosition[]): StrokeFragment[] {
  if (rawPoints.length === 0) return [];
  if (rawPoints.length === 1) {
    const p = rawPoints[0];
    return [{
      tileX: p.tileX,
      tileY: p.tileY,
      points: [{ x: p.x, y: p.y }],
    }];
  }

  const fragments: StrokeFragment[] = [];
  let currentTileX = rawPoints[0].tileX;
  let currentTileY = rawPoints[0].tileY;
  let currentPoints: LocalPoint[] = [{ x: rawPoints[0].x, y: rawPoints[0].y }];

  for (let i = 1; i < rawPoints.length; i++) {
    const p1 = rawPoints[i - 1];
    const p2 = rawPoints[i];

    if (p1.tileX === p2.tileX && p1.tileY === p2.tileY) {
      currentPoints.push({ x: p2.x, y: p2.y });
    } else {
      // Crosses tile boundary between p1 and p2!
      // Convert p2 relative to p1's tile space
      const dtx = p2.tileX - p1.tileX;
      const dty = p2.tileY - p1.tileY;

      const p2InP1X = p2.x + dtx * TILE_UNITS;
      const p2InP1Y = p2.y + dty * TILE_UNITS;

      // Find boundary intersections with x=0, x=TILE_UNITS, y=0, y=TILE_UNITS
      const dx = p2InP1X - p1.x;
      const dy = p2InP1Y - p1.y;

      // Find parametric t for intersections in (0, 1)
      const ts: number[] = [];

      if (dx !== 0) {
        // Intersections with x = k * TILE_UNITS
        const minX = Math.min(p1.x, p2InP1X);
        const maxX = Math.max(p1.x, p2InP1X);
        for (let k = Math.floor(minX / TILE_UNITS); k <= Math.ceil(maxX / TILE_UNITS); k++) {
          const borderX = k * TILE_UNITS;
          const t = (borderX - p1.x) / dx;
          if (t > 0.00001 && t < 0.99999) {
            ts.push(t);
          }
        }
      }

      if (dy !== 0) {
        // Intersections with y = m * TILE_UNITS
        const minY = Math.min(p1.y, p2InP1Y);
        const maxY = Math.max(p1.y, p2InP1Y);
        for (let m = Math.floor(minY / TILE_UNITS); m <= Math.ceil(maxY / TILE_UNITS); m++) {
          const borderY = m * TILE_UNITS;
          const t = (borderY - p1.y) / dy;
          if (t > 0.00001 && t < 0.99999) {
            ts.push(t);
          }
        }
      }

      ts.sort((a, b) => a - b);
      // Remove duplicates
      const uniqueTs = ts.filter((t, idx, arr) => idx === 0 || t - arr[idx - 1] > 0.00001);

      let prevT = 0;
      let prevTilePos = p1;

      for (const t of uniqueTs) {
        // Leaving point: just before crossing
        const tLeaving = Math.max(0, t - 0.00001);
        const interLeavingX = p1.x + tLeaving * dx;
        const interLeavingY = p1.y + tLeaving * dy;
        const interLeaving = normalizeTileUnits(p1.tileX, p1.tileY, interLeavingX, interLeavingY);

        // Clamp to currentTile boundaries
        const leavingPt: LocalPoint = {
          x: Math.min(TILE_UNITS - 1, Math.max(0, interLeaving.x)),
          y: Math.min(TILE_UNITS - 1, Math.max(0, interLeaving.y)),
        };

        // If dx > 0 and crossing right border, clamp to right edge
        if (dx > 0 && Math.abs(p1.x + t * dx - Math.round((p1.x + t * dx) / TILE_UNITS) * TILE_UNITS) < 2) {
          leavingPt.x = TILE_UNITS - 1;
        } else if (dx < 0 && Math.abs(p1.x + t * dx - Math.round((p1.x + t * dx) / TILE_UNITS) * TILE_UNITS) < 2) {
          leavingPt.x = 0;
        }

        if (dy > 0 && Math.abs(p1.y + t * dy - Math.round((p1.y + t * dy) / TILE_UNITS) * TILE_UNITS) < 2) {
          leavingPt.y = TILE_UNITS - 1;
        } else if (dy < 0 && Math.abs(p1.y + t * dy - Math.round((p1.y + t * dy) / TILE_UNITS) * TILE_UNITS) < 2) {
          leavingPt.y = 0;
        }

        currentPoints.push(leavingPt);

        // Finish current fragment
        fragments.push({
          tileX: currentTileX,
          tileY: currentTileY,
          points: currentPoints,
        });

        // Entering point: just after crossing
        const tEntering = Math.min(1, t + 0.00001);
        const interEnteringX = p1.x + tEntering * dx;
        const interEnteringY = p1.y + tEntering * dy;
        const interEntering = normalizeTileUnits(p1.tileX, p1.tileY, interEnteringX, interEnteringY);

        const enteringPt: LocalPoint = {
          x: Math.min(TILE_UNITS - 1, Math.max(0, interEntering.x)),
          y: Math.min(TILE_UNITS - 1, Math.max(0, interEntering.y)),
        };

        if (dx > 0 && Math.abs(p1.x + t * dx - Math.round((p1.x + t * dx) / TILE_UNITS) * TILE_UNITS) < 2) {
          enteringPt.x = 0;
        } else if (dx < 0 && Math.abs(p1.x + t * dx - Math.round((p1.x + t * dx) / TILE_UNITS) * TILE_UNITS) < 2) {
          enteringPt.x = TILE_UNITS - 1;
        }

        if (dy > 0 && Math.abs(p1.y + t * dy - Math.round((p1.y + t * dy) / TILE_UNITS) * TILE_UNITS) < 2) {
          enteringPt.y = 0;
        } else if (dy < 0 && Math.abs(p1.y + t * dy - Math.round((p1.y + t * dy) / TILE_UNITS) * TILE_UNITS) < 2) {
          enteringPt.y = TILE_UNITS - 1;
        }

        currentTileX = interEntering.tileX;
        currentTileY = interEntering.tileY;
        currentPoints = [enteringPt];
      }

      // Finish to p2
      currentTileX = p2.tileX;
      currentTileY = p2.tileY;
      currentPoints.push({ x: p2.x, y: p2.y });
    }
  }

  if (currentPoints.length > 0) {
    fragments.push({
      tileX: currentTileX,
      tileY: currentTileY,
      points: currentPoints,
    });
  }

  return fragments;
}

export interface CubicBezierSegment {
  p0: LocalPoint;
  cp1: LocalPoint;
  cp2: LocalPoint;
  p1: LocalPoint;
}

/**
 * Converts Catmull-Rom spline through points into cubic Bezier curve segments.
 * Uniform Catmull-Rom (alpha = 0, tension = 0.5):
 * CP1 = P1 + (P2 - P0) / 6
 * CP2 = P2 - (P3 - P1) / 6
 */
export function catmullRomToBezier(points: readonly LocalPoint[]): CubicBezierSegment[] {
  if (points.length < 2) return [];

  const segments: CubicBezierSegment[] = [];
  const n = points.length;

  for (let i = 0; i < n - 1; i++) {
    const p0 = i === 0 ? points[0] : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < n ? points[i + 2] : p2;

    const cp1: LocalPoint = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    };

    const cp2: LocalPoint = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    };

    segments.push({ p0: p1, cp1, cp2, p1: p2 });
  }

  return segments;
}
