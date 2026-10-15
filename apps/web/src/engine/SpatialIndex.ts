import { LocalPoint, TILE_UNITS, BRUSH_WIDTHS } from '@infinite-canvas/shared';

export interface StoredStroke {
  id: number;
  tileX: number;
  tileY: number;
  colorIndex: number;
  widthIndex: number;
  points: LocalPoint[];
  // Pre-calculated AABB in tile units
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const GRID_SIZE = 16;
const GRID_CELL_UNITS = TILE_UNITS / GRID_SIZE; // 4096 units

/**
 * 16x16 spatial grid index for a single tile.
 */
export class TileSpatialIndex {
  readonly tileX: number;
  readonly tileY: number;
  private readonly grid: number[][][]; // 16x16 array of stroke IDs
  private readonly strokes: Map<number, StoredStroke> = new Map();

  constructor(tileX: number, tileY: number) {
    this.tileX = tileX;
    this.tileY = tileY;
    this.grid = Array.from({ length: GRID_SIZE }, () =>
      Array.from({ length: GRID_SIZE }, () => [])
    );
  }

  insert(stroke: StoredStroke): void {
    this.strokes.set(stroke.id, stroke);

    const halfWidth = (BRUSH_WIDTHS[stroke.widthIndex] || 64) / 2;
    const gx0 = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((stroke.minX - halfWidth) / GRID_CELL_UNITS)));
    const gy0 = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((stroke.minY - halfWidth) / GRID_CELL_UNITS)));
    const gx1 = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((stroke.maxX + halfWidth) / GRID_CELL_UNITS)));
    const gy1 = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((stroke.maxY + halfWidth) / GRID_CELL_UNITS)));

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        this.grid[gy][gx].push(stroke.id);
      }
    }
  }

  /**
   * Queries strokes intersecting an AABB in local tile units.
   * Results are returned in ascending order of stroke id.
   */
  query(minX: number, minY: number, maxX: number, maxY: number): StoredStroke[] {
    const gx0 = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(minX / GRID_CELL_UNITS)));
    const gy0 = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(minY / GRID_CELL_UNITS)));
    const gx1 = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(maxX / GRID_CELL_UNITS)));
    const gy1 = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(maxY / GRID_CELL_UNITS)));

    const seenIds = new Set<number>();
    const result: StoredStroke[] = [];

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cellStrokes = this.grid[gy][gx];
        for (let i = 0; i < cellStrokes.length; i++) {
          const id = cellStrokes[i];
          if (!seenIds.has(id)) {
            seenIds.add(id);
            const stroke = this.strokes.get(id);
            if (stroke) {
              // Exact AABB intersection check
              const halfWidth = (BRUSH_WIDTHS[stroke.widthIndex] || 64) / 2;
              if (
                stroke.maxX + halfWidth >= minX &&
                stroke.minX - halfWidth <= maxX &&
                stroke.maxY + halfWidth >= minY &&
                stroke.minY - halfWidth <= maxY
              ) {
                result.push(stroke);
              }
            }
          }
        }
      }
    }

    // Sort by ascending stroke id
    return result.sort((a, b) => a.id - b.id);
  }

  getAllStrokes(): StoredStroke[] {
    return Array.from(this.strokes.values()).sort((a, b) => a.id - b.id);
  }

  get strokeCount(): number {
    return this.strokes.size;
  }
}
