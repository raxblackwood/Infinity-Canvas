import {
  CANVAS_BG_COLOR,
  CELL_PX,
  DEFAULT_SCALE,
  PALETTE,
  BRUSH_WIDTHS,
  TILE_UNITS,
  VECTOR_MIN_SCALE,
  catmullRomToBezier,
  getCellKey,
  getCellsPerTileAxis,
  getCellSizeUnits,
  getZoomQuantization,
  tilePositionToScreen,
  Viewport,
} from '@infinite-canvas/shared';
import { Camera } from './Camera.js';
import { TileSpatialIndex, StoredStroke } from './SpatialIndex.js';
import { RenderCellCache, CachedCell } from './RenderCellCache.js';

export interface PerformanceStats {
  fps: number;
  frameTimeMs: number;
  visibleCells: number;
  cachedCells: number;
  memoryUsedMB: number;
  scale: number;
  zq: number | null;
}

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera: Camera;
  private readonly cellCache: RenderCellCache;
  private readonly tileIndices: Map<string, TileSpatialIndex> = new Map();

  private dpr = 1;
  private width = 0;
  private height = 0;
  private currentFrame = 0;
  private isDirty = true;
  private activeZq: number | null = null;
  private targetZq: number | null = null;
  private settleTimeout: number | null = null;

  // Performance tracking
  private lastFrameTimestamp = performance.now();
  private frameTimes: number[] = [];
  private renderDurations: number[] = [];
  private currentStats: PerformanceStats = {
    fps: 60,
    frameTimeMs: 0,
    visibleCells: 0,
    cachedCells: 0,
    memoryUsedMB: 0,
    scale: DEFAULT_SCALE,
    zq: 11,
  };

  // Live in-progress stroke for immediate optimistic rendering
  private activeLiveStroke: {
    tileX: number;
    tileY: number;
    colorIndex: number;
    widthIndex: number;
    points: { x: number; y: number }[];
  } | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, isMobile = false) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.camera = camera;
    this.cellCache = new RenderCellCache(isMobile);
    this.updateViewport();
  }

  updateViewport(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.markDirty();
  }

  getViewport(): Viewport {
    return {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
    };
  }

  getTileIndex(tx: number, ty: number): TileSpatialIndex {
    const key = `${tx},${ty}`;
    let index = this.tileIndices.get(key);
    if (!index) {
      index = new TileSpatialIndex(tx, ty);
      this.tileIndices.set(key, index);
    }
    return index;
  }

  addStroke(stroke: StoredStroke): void {
    const index = this.getTileIndex(stroke.tileX, stroke.tileY);
    index.insert(stroke);
    this.cellCache.invalidateTile(stroke.tileX, stroke.tileY);
    this.markDirty();
  }

  setActiveLiveStroke(stroke: typeof this.activeLiveStroke): void {
    this.activeLiveStroke = stroke;
    this.markDirty();
  }

  markDirty(): void {
    this.isDirty = true;
  }

  render(): PerformanceStats {
    const frameStart = performance.now();
    this.currentFrame++;

    // Calculate FPS
    const delta = frameStart - this.lastFrameTimestamp;
    this.lastFrameTimestamp = frameStart;
    if (delta > 0) {
      const instantFps = 1000 / delta;
      this.frameTimes.push(instantFps);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
    }
    const avgFps = this.frameTimes.length
      ? Math.round(this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length)
      : 60;

    // Check zoom quantization
    const newZq = getZoomQuantization(this.camera.scale, this.dpr);

    if (this.targetZq !== newZq) {
      this.targetZq = newZq;
      if (this.activeZq === null) {
        this.activeZq = newZq;
      } else {
        // Debounce settle for 150 ms
        if (this.settleTimeout !== null) {
          clearTimeout(this.settleTimeout);
        }
        this.settleTimeout = window.setTimeout(() => {
          this.activeZq = this.targetZq;
          this.markDirty();
        }, 150);
      }
    }

    const zqToRender = this.activeZq ?? newZq;

    // Clear background with warm paper
    this.ctx.fillStyle = CANVAS_BG_COLOR;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let visibleCellsCount = 0;

    // Amendment 1: Below VECTOR_MIN_SCALE (512), no render cells until Phase 2 raster pyramid
    if (this.camera.scale < VECTOR_MIN_SCALE || zqToRender === null || zqToRender < 9) {
      this.renderLowZoomPlaceholder();
    } else {
      visibleCellsCount = this.renderVectorCells(zqToRender);
    }

    // Render live in-progress stroke on top
    if (this.activeLiveStroke && this.activeLiveStroke.points.length > 0) {
      this.renderLiveStroke(this.activeLiveStroke);
    }

    const frameEnd = performance.now();
    const duration = frameEnd - frameStart;
    this.renderDurations.push(duration);
    if (this.renderDurations.length > 30) this.renderDurations.shift();
    const avgDuration = Number(
      (this.renderDurations.reduce((a, b) => a + b, 0) / this.renderDurations.length).toFixed(2)
    );

    this.currentStats = {
      fps: avgFps,
      frameTimeMs: avgDuration,
      visibleCells: visibleCellsCount,
      cachedCells: this.cellCache.cellCount,
      memoryUsedMB: Number((this.cellCache.memoryUsedBytes / (1024 * 1024)).toFixed(1)),
      scale: Math.round(this.camera.scale),
      zq: zqToRender,
    };

    this.isDirty = false;
    return this.currentStats;
  }

  private renderVectorCells(zq: number): number {
    const viewport = this.getViewport();
    const cellsPerAxis = getCellsPerTileAxis(zq);
    const unitsPerCell = getCellSizeUnits(zq);

    // Determine visible tile range
    const halfW = viewport.width / 2;
    const halfH = viewport.height / 2;

    const minTileX = Math.floor(this.camera.tileX + this.camera.offsetX - halfW / this.camera.scale);
    const maxTileX = Math.floor(this.camera.tileX + this.camera.offsetX + halfW / this.camera.scale);
    const minTileY = Math.floor(this.camera.tileY + this.camera.offsetY - halfH / this.camera.scale);
    const maxTileY = Math.floor(this.camera.tileY + this.camera.offsetY + halfH / this.camera.scale);

    const visibleKeys = new Set<string>();
    let visibleCount = 0;

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        // For each tile, check which cells overlap the viewport
        for (let cy = 0; cy < cellsPerAxis; cy++) {
          for (let cx = 0; cx < cellsPerAxis; cx++) {
            const cellMinX = cx * unitsPerCell;
            const cellMinY = cy * unitsPerCell;
            const cellMaxX = (cx + 1) * unitsPerCell;
            const cellMaxY = (cy + 1) * unitsPerCell;

            // Screen bounding box of this cell
            const pTopLeft = tilePositionToScreen(tx, ty, cellMinX, cellMinY, this.camera, viewport);
            const pBottomRight = tilePositionToScreen(tx, ty, cellMaxX, cellMaxY, this.camera, viewport);

            // Viewport clipping test
            if (
              pBottomRight.x >= 0 &&
              pTopLeft.x <= viewport.width &&
              pBottomRight.y >= 0 &&
              pTopLeft.y <= viewport.height
            ) {
              const key = getCellKey(tx, ty, zq, cx, cy);
              visibleKeys.add(key);
              visibleCount++;

              let cell = this.cellCache.get(key, this.currentFrame);
              if (!cell) {
                cell = this.cellCache.createCell(tx, ty, zq, cx, cy, this.currentFrame);
                this.rasterizeCell(cell, tx, ty, zq, cellMinX, cellMinY, cellMaxX, cellMaxY);
              }

              // Blit cell bitmap to main canvas
              // Coordinates on canvas in device pixels:
              const destX = pTopLeft.x * this.dpr;
              const destY = pTopLeft.y * this.dpr;
              const destW = (pBottomRight.x - pTopLeft.x) * this.dpr;
              const destH = (pBottomRight.y - pTopLeft.y) * this.dpr;

              this.ctx.drawImage(cell.canvas, 0, 0, CELL_PX, CELL_PX, destX, destY, destW, destH);
            }
          }
        }
      }
    }

    // Enforce LRU cache budget
    this.cellCache.evict(visibleKeys);
    return visibleCount;
  }

  private rasterizeCell(
    cell: CachedCell,
    tx: number,
    ty: number,
    zq: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const ctx = cell.ctx;
    ctx.clearRect(0, 0, CELL_PX, CELL_PX);

    const tileIndex = this.getTileIndex(tx, ty);
    const strokes = tileIndex.query(minX, minY, maxX, maxY);
    if (strokes.length === 0) return;

    const cellWidthUnits = maxX - minX;
    const unitsToCellPx = CELL_PX / cellWidthUnits;

    // In 2^zq space, full tile is 2^zq device px
    const tilePxAtZq = Math.pow(2, zq);

    for (const stroke of strokes) {
      const brushWidthUnits = BRUSH_WIDTHS[stroke.widthIndex] || 64;
      const strokeWidthPx = (brushWidthUnits / TILE_UNITS) * tilePxAtZq;

      // Skip strokes under 0.5 device px at current zq (SPEC Section 8)
      if (strokeWidthPx < 0.5) continue;

      const color = PALETTE[stroke.colorIndex] ? PALETTE[stroke.colorIndex].hex : '#1A1A1A';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = strokeWidthPx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        const cx = (p.x - minX) * unitsToCellPx;
        const cy = (p.y - minY) * unitsToCellPx;
        ctx.beginPath();
        ctx.arc(cx, cy, strokeWidthPx / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (stroke.points.length >= 2) {
        const beziers = catmullRomToBezier(stroke.points);
        ctx.beginPath();
        const p0 = stroke.points[0];
        ctx.moveTo((p0.x - minX) * unitsToCellPx, (p0.y - minY) * unitsToCellPx);

        for (const seg of beziers) {
          ctx.bezierCurveTo(
            (seg.cp1.x - minX) * unitsToCellPx,
            (seg.cp1.y - minY) * unitsToCellPx,
            (seg.cp2.x - minX) * unitsToCellPx,
            (seg.cp2.y - minY) * unitsToCellPx,
            (seg.p1.x - minX) * unitsToCellPx,
            (seg.p1.y - minY) * unitsToCellPx
          );
        }
        ctx.stroke();
      }
    }
  }

  private renderLiveStroke(stroke: NonNullable<typeof this.activeLiveStroke>): void {
    const viewport = this.getViewport();
    const brushWidthUnits = BRUSH_WIDTHS[stroke.widthIndex] || 64;
    const brushWidthCssPx = (brushWidthUnits / TILE_UNITS) * this.camera.scale;
    const strokeWidthDevPx = brushWidthCssPx * this.dpr;

    const color = PALETTE[stroke.colorIndex] ? PALETTE[stroke.colorIndex].hex : '#1A1A1A';
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = strokeWidthDevPx;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      const scr = tilePositionToScreen(stroke.tileX, stroke.tileY, p.x, p.y, this.camera, viewport);
      this.ctx.beginPath();
      this.ctx.arc(scr.x * this.dpr, scr.y * this.dpr, strokeWidthDevPx / 2, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (stroke.points.length >= 2) {
      const beziers = catmullRomToBezier(stroke.points);
      this.ctx.beginPath();
      const p0 = tilePositionToScreen(
        stroke.tileX,
        stroke.tileY,
        stroke.points[0].x,
        stroke.points[0].y,
        this.camera,
        viewport
      );
      this.ctx.moveTo(p0.x * this.dpr, p0.y * this.dpr);

      for (const seg of beziers) {
        const cp1 = tilePositionToScreen(stroke.tileX, stroke.tileY, seg.cp1.x, seg.cp1.y, this.camera, viewport);
        const cp2 = tilePositionToScreen(stroke.tileX, stroke.tileY, seg.cp2.x, seg.cp2.y, this.camera, viewport);
        const p1 = tilePositionToScreen(stroke.tileX, stroke.tileY, seg.p1.x, seg.p1.y, this.camera, viewport);

        this.ctx.bezierCurveTo(
          cp1.x * this.dpr,
          cp1.y * this.dpr,
          cp2.x * this.dpr,
          cp2.y * this.dpr,
          p1.x * this.dpr,
          p1.y * this.dpr
        );
      }
      this.ctx.stroke();
    }
  }

  private renderLowZoomPlaceholder(): void {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    this.ctx.save();
    this.ctx.fillStyle = '#1A1A1A';
    this.ctx.font = `600 ${18 * this.dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      `Raster Mode Placeholder (Zoom: ${Math.round(this.camera.scale)} px/tile)`,
      cx,
      cy - 12 * this.dpr
    );

    this.ctx.font = `400 ${14 * this.dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    this.ctx.fillStyle = '#6B6B6B';
    this.ctx.fillText(
      'Zoom >= 512 for vector render cells. Raster pyramid LOD activates in Phase 2.',
      cx,
      cy + 16 * this.dpr
    );
    this.ctx.restore();
  }

  get stats(): PerformanceStats {
    return this.currentStats;
  }

  get dirty(): boolean {
    return this.isDirty;
  }
}
