import {
  CELL_PX,
  BITMAP_CACHE_MOBILE,
  BITMAP_CACHE_DESKTOP,
  getCellKey,
} from '@infinite-canvas/shared';

export interface CachedCell {
  key: string;
  tx: number;
  ty: number;
  zq: number;
  cellX: number;
  cellY: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lastUsedFrame: number;
  bytes: number;
}

const BYTES_PER_CELL = CELL_PX * CELL_PX * 4; // 1 MB

export class RenderCellCache {
  private readonly cells: Map<string, CachedCell> = new Map();
  private maxBytes: number;
  private currentBytes = 0;

  constructor(isMobile = false) {
    this.maxBytes = isMobile ? BITMAP_CACHE_MOBILE : BITMAP_CACHE_DESKTOP;
  }

  get(key: string, currentFrame: number): CachedCell | undefined {
    const cell = this.cells.get(key);
    if (cell) {
      cell.lastUsedFrame = currentFrame;
    }
    return cell;
  }

  createCell(
    tx: number,
    ty: number,
    zq: number,
    cellX: number,
    cellY: number,
    currentFrame: number
  ): CachedCell {
    const key = getCellKey(tx, ty, zq, cellX, cellY);

    const canvas = document.createElement('canvas');
    canvas.width = CELL_PX;
    canvas.height = CELL_PX;
    const ctx = canvas.getContext('2d', { alpha: true })!;

    const cell: CachedCell = {
      key,
      tx,
      ty,
      zq,
      cellX,
      cellY,
      canvas,
      ctx,
      lastUsedFrame: currentFrame,
      bytes: BYTES_PER_CELL,
    };

    this.cells.set(key, cell);
    this.currentBytes += cell.bytes;

    return cell;
  }

  /**
   * Enforces the memory budget by evicting least-recently used cells that are not currently visible.
   */
  evict(visibleKeys: Set<string>): void {
    if (this.currentBytes <= this.maxBytes) return;

    // Collect candidates that are NOT currently visible
    const evictable: CachedCell[] = [];
    for (const cell of this.cells.values()) {
      if (!visibleKeys.has(cell.key)) {
        evictable.push(cell);
      }
    }

    // Sort ascending by lastUsedFrame (oldest first)
    evictable.sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);

    for (const cell of evictable) {
      this.cells.delete(cell.key);
      this.currentBytes -= cell.bytes;
      // Allow canvas memory to be garbage-collected
      cell.canvas.width = 0;
      cell.canvas.height = 0;

      if (this.currentBytes <= this.maxBytes) {
        break;
      }
    }
  }

  /**
   * Invalidates cells for a given tile.
   */
  invalidateTile(tx: number, ty: number): void {
    for (const [key, cell] of this.cells.entries()) {
      if (cell.tx === tx && cell.ty === ty) {
        this.cells.delete(key);
        this.currentBytes -= cell.bytes;
        cell.canvas.width = 0;
        cell.canvas.height = 0;
      }
    }
  }

  clear(): void {
    for (const cell of this.cells.values()) {
      cell.canvas.width = 0;
      cell.canvas.height = 0;
    }
    this.cells.clear();
    this.currentBytes = 0;
  }

  get memoryUsedBytes(): number {
    return this.currentBytes;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  get budgetBytes(): number {
    return this.maxBytes;
  }
}
