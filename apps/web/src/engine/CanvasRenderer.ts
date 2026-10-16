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
import { RasterTileCache } from './RasterCache.js';

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
  private readonly rasterCache: RasterTileCache;
  private readonly tileIndices: Map<string, TileSpatialIndex> = new Map();

  private dpr = 1;
  private width = 0;
  private height = 0;
  private currentFrame = 0;
  private isDirty = true;
  private activeZq: number | null = null;
  private targetZq: number | null = null;
  private settleTimeout: number | null = null;
  private prevScale: number = DEFAULT_SCALE;
  private crossfadeState: { startTime: number; direction: 'toRaster' | 'toVector' } | null = null;
  public showPhase0Placeholder = false;

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

  public remoteLiveStrokesProvider?: () => {
    tileX: number;
    tileY: number;
    colorIndex: number;
    widthIndex: number;
    points: { x: number; y: number }[];
  }[];

  // Tile Selection Overlay (Phase 4 Moderation)
  public selectedTiles: Set<string> = new Set();
  public selectionMarquee: { startX: number; startY: number; currentX: number; currentY: number } | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, isMobile = false) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.camera = camera;
    this.cellCache = new RenderCellCache(isMobile);
    this.rasterCache = new RasterTileCache({ onTileLoaded: () => this.markDirty() });
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

  removeStroke(tileX: number, tileY: number, strokeId: number): void {
    const key = `${tileX},${tileY}`;
    const index = this.tileIndices.get(key);
    if (index) {
      index.remove(strokeId);
      this.cellCache.invalidateTile(tileX, tileY);
      this.markDirty();
    }
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

    const isRaster = this.camera.scale < VECTOR_MIN_SCALE;
    const wasRaster = this.prevScale < VECTOR_MIN_SCALE;

    if (isRaster && !wasRaster) {
      this.crossfadeState = { startTime: performance.now(), direction: 'toRaster' };
    } else if (!isRaster && wasRaster) {
      this.crossfadeState = { startTime: performance.now(), direction: 'toVector' };
    }
    this.prevScale = this.camera.scale;

    if (this.crossfadeState) {
      const elapsed = performance.now() - this.crossfadeState.startTime;
      const t = Math.min(1, elapsed / 150);
      const ease = 1 - Math.pow(1 - t, 2);
      const rasterAlpha = this.crossfadeState.direction === 'toRaster' ? ease : 1 - ease;
      const vectorAlpha = this.crossfadeState.direction === 'toRaster' ? 1 - ease : ease;

      const k = Math.max(0, Math.min(12, Math.floor(Math.log2(1024 / (this.camera.scale * this.dpr)))));
      this.renderRasterTiles(k, rasterAlpha);

      if (zqToRender !== null && zqToRender >= 9) {
        visibleCellsCount = this.renderVectorCells(zqToRender, vectorAlpha);
      }

      if (t < 1) {
        requestAnimationFrame(() => this.markDirty());
      } else {
        this.crossfadeState = null;
      }
    } else if (isRaster) {
      const k = Math.max(0, Math.min(12, Math.floor(Math.log2(1024 / (this.camera.scale * this.dpr)))));
      const renderedRasters = this.renderRasterTiles(k, 1);
      if (renderedRasters === 0) {
        if (this.showPhase0Placeholder) {
          this.renderLowZoomPlaceholder();
        } else {
          visibleCellsCount = this.renderVectorCells(9, 1);
        }
      }
    } else {
      visibleCellsCount = this.renderVectorCells(zqToRender ?? 11, 1);
    }

    // Render live in-progress stroke on top
    if (this.activeLiveStroke && this.activeLiveStroke.points.length > 0) {
      this.renderLiveStroke(this.activeLiveStroke);
    }

    // Render remote peer live strokes
    if (this.remoteLiveStrokesProvider) {
      const remotes = this.remoteLiveStrokesProvider();
      for (const remote of remotes) {
        if (remote.points.length > 0) {
          this.renderLiveStroke(remote);
        }
      }
    }

    // Render selected tiles overlay (Phase 4 Moderation & Tile Selection)
    if (this.selectedTiles.size > 0) {
      this.renderSelectedTilesOverlay();
    }

    // Render active drag selection marquee
    if (this.selectionMarquee) {
      this.renderSelectionMarquee(this.selectionMarquee);
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

  private renderRasterTiles(level: number, alpha: number): number {
    const viewport = this.getViewport();
    const halfW = viewport.width / 2;
    const halfH = viewport.height / 2;

    const minTx = Math.floor(this.camera.tileX + this.camera.offsetX - halfW / this.camera.scale);
    const maxTx = Math.floor(this.camera.tileX + this.camera.offsetX + halfW / this.camera.scale);
    const minTy = Math.floor(this.camera.tileY + this.camera.offsetY - halfH / this.camera.scale);
    const maxTy = Math.floor(this.camera.tileY + this.camera.offsetY + halfH / this.camera.scale);

    const step = 1 << level; // 2^level base tiles per raster tile
    const minRx = Math.floor(minTx / step);
    const maxRx = Math.floor(maxTx / step);
    const minRy = Math.floor(minTy / step);
    const maxRy = Math.floor(maxTy / step);

    let renderedCount = 0;

    this.ctx.save();
    this.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    for (let ry = minRy; ry <= maxRy; ry++) {
      for (let rx = minRx; rx <= maxRx; rx++) {
        const baseTx = rx * step;
        const baseTy = ry * step;

        const pTL = tilePositionToScreen(baseTx, baseTy, 0, 0, this.camera, viewport);
        const pBR = tilePositionToScreen(baseTx + step, baseTy + step, 0, 0, this.camera, viewport);

        const destX = pTL.x * this.dpr;
        const destY = pTL.y * this.dpr;
        const destW = (pBR.x - pTL.x) * this.dpr;
        const destH = (pBR.y - pTL.y) * this.dpr;

        if (
          destX + destW >= 0 &&
          destX <= this.canvas.width &&
          destY + destH >= 0 &&
          destY <= this.canvas.height
        ) {
          const img = this.rasterCache.get(level, rx, ry);
          if (img) {
            this.ctx.drawImage(img, destX, destY, destW, destH);
            renderedCount++;
          }
        }
      }
    }

    this.ctx.restore();
    return renderedCount;
  }

  private renderVectorCells(zq: number, alpha = 1): number {
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

    this.ctx.save();
    if (alpha < 1) {
      this.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    }

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

    this.ctx.restore();

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

  setSelectedTiles(tiles: { tileX: number; tileY: number }[]): void {
    this.selectedTiles.clear();
    for (const t of tiles) {
      this.selectedTiles.add(`${t.tileX},${t.tileY}`);
    }
    this.markDirty();
  }

  setSelectionMarquee(marquee: { startX: number; startY: number; currentX: number; currentY: number } | null): void {
    this.selectionMarquee = marquee;
    this.markDirty();
  }

  private renderSelectedTilesOverlay(): void {
    const viewport = this.getViewport();
    this.ctx.save();

    for (const key of this.selectedTiles) {
      const [txStr, tyStr] = key.split(',');
      const tx = parseInt(txStr, 10);
      const ty = parseInt(tyStr, 10);

      const pTopLeft = tilePositionToScreen(tx, ty, 0, 0, this.camera, viewport);
      const pBottomRight = tilePositionToScreen(tx, ty, 65535, 65535, this.camera, viewport);

      const x = pTopLeft.x * this.dpr;
      const y = pTopLeft.y * this.dpr;
      const w = (pBottomRight.x - pTopLeft.x) * this.dpr;
      const h = (pBottomRight.y - pTopLeft.y) * this.dpr;

      if (x + w < 0 || x > this.canvas.width || y + h < 0 || y > this.canvas.height) {
        continue;
      }

      // Semi-transparent red highlight
      this.ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
      this.ctx.fillRect(x, y, w, h);

      // Red dashed border
      this.ctx.strokeStyle = '#DC2626';
      this.ctx.lineWidth = 2.5 * this.dpr;
      this.ctx.setLineDash([8 * this.dpr, 5 * this.dpr]);
      this.ctx.strokeRect(x, y, w, h);
      this.ctx.setLineDash([]);

      // Tile label badge
      const badgeText = `Tile (${tx}, ${ty})`;
      this.ctx.font = `bold ${Math.max(11, Math.round(13 * this.dpr))}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const textMetrics = this.ctx.measureText(badgeText);
      const badgeW = textMetrics.width + 16 * this.dpr;
      const badgeH = 24 * this.dpr;

      this.ctx.fillStyle = '#DC2626';
      this.ctx.beginPath();
      if (typeof (this.ctx as any).roundRect === 'function') {
        (this.ctx as any).roundRect(x + 8 * this.dpr, y + 8 * this.dpr, badgeW, badgeH, 6 * this.dpr);
      } else {
        this.ctx.rect(x + 8 * this.dpr, y + 8 * this.dpr, badgeW, badgeH);
      }
      this.ctx.fill();

      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(badgeText, x + 16 * this.dpr, y + 8 * this.dpr + badgeH / 2);
    }

    this.ctx.restore();
  }

  private renderSelectionMarquee(box: { startX: number; startY: number; currentX: number; currentY: number }): void {
    this.ctx.save();

    const minX = Math.min(box.startX, box.currentX) * this.dpr;
    const maxX = Math.max(box.startX, box.currentX) * this.dpr;
    const minY = Math.min(box.startY, box.currentY) * this.dpr;
    const maxY = Math.max(box.startY, box.currentY) * this.dpr;
    const w = maxX - minX;
    const h = maxY - minY;

    this.ctx.fillStyle = 'rgba(220, 38, 38, 0.15)';
    this.ctx.fillRect(minX, minY, w, h);

    this.ctx.strokeStyle = '#DC2626';
    this.ctx.lineWidth = 1.5 * this.dpr;
    this.ctx.setLineDash([5 * this.dpr, 4 * this.dpr]);
    this.ctx.strokeRect(minX, minY, w, h);

    this.ctx.restore();
  }

  get stats(): PerformanceStats {
    return this.currentStats;
  }

  get dirty(): boolean {
    return this.isDirty;
  }

  getAllLoadedStrokes(filterTiles?: { tileX: number; tileY: number }[]): StoredStroke[] {
    const strokes: StoredStroke[] = [];
    if (filterTiles && filterTiles.length > 0) {
      for (const t of filterTiles) {
        const idx = this.tileIndices.get(`${t.tileX},${t.tileY}`);
        if (idx) {
          strokes.push(...idx.getAllStrokes());
        }
      }
    } else {
      for (const idx of this.tileIndices.values()) {
        strokes.push(...idx.getAllStrokes());
      }
    }
    return strokes.sort((a, b) => a.id - b.id);
  }

  exportPNG(multiplier = 2): string {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.canvas.width * multiplier;
    exportCanvas.height = this.canvas.height * multiplier;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return this.canvas.toDataURL('image/png');

    ctx.fillStyle = CANVAS_BG_COLOR;
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(this.canvas, 0, 0, exportCanvas.width, exportCanvas.height);
    return exportCanvas.toDataURL('image/png');
  }

  exportSVG(filterTiles?: { tileX: number; tileY: number }[]): string {
    const strokes = this.getAllLoadedStrokes(filterTiles);

    let minTx = filterTiles && filterTiles.length > 0 ? Math.min(...filterTiles.map((t) => t.tileX)) : this.camera.tileX;
    let maxTx = filterTiles && filterTiles.length > 0 ? Math.max(...filterTiles.map((t) => t.tileX)) : this.camera.tileX;
    let minTy = filterTiles && filterTiles.length > 0 ? Math.min(...filterTiles.map((t) => t.tileY)) : this.camera.tileY;
    let maxTy = filterTiles && filterTiles.length > 0 ? Math.max(...filterTiles.map((t) => t.tileY)) : this.camera.tileY;

    if (strokes.length > 0 && (!filterTiles || filterTiles.length === 0)) {
      minTx = Math.min(...strokes.map((s) => s.tileX));
      maxTx = Math.max(...strokes.map((s) => s.tileX));
      minTy = Math.min(...strokes.map((s) => s.tileY));
      maxTy = Math.max(...strokes.map((s) => s.tileY));
    }

    const tileCols = Math.max(1, maxTx - minTx + 1);
    const tileRows = Math.max(1, maxTy - minTy + 1);
    const svgWidth = tileCols * 1024;
    const svgHeight = tileRows * 1024;

    const pathStrings: string[] = [];
    for (const stroke of strokes) {
      const color = PALETTE[stroke.colorIndex]?.hex || '#1A1A1A';
      const widthUnits = BRUSH_WIDTHS[stroke.widthIndex] || 256;
      const strokeWidthSvg = Math.max(1, (widthUnits / TILE_UNITS) * 1024);

      const tileOffsetX = (stroke.tileX - minTx) * 1024;
      const tileOffsetY = (stroke.tileY - minTy) * 1024;

      if (stroke.points.length === 1) {
        const cx = tileOffsetX + (stroke.points[0].x / TILE_UNITS) * 1024;
        const cy = tileOffsetY + (stroke.points[0].y / TILE_UNITS) * 1024;
        const r = strokeWidthSvg / 2;
        pathStrings.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" />`);
      } else if (stroke.points.length > 1) {
        const beziers = catmullRomToBezier(stroke.points);
        if (beziers.length > 0) {
          let d = `M ${(tileOffsetX + (beziers[0].p0.x / TILE_UNITS) * 1024).toFixed(1)} ${(tileOffsetY + (beziers[0].p0.y / TILE_UNITS) * 1024).toFixed(1)}`;
          for (const b of beziers) {
            const cp1x = (tileOffsetX + (b.cp1.x / TILE_UNITS) * 1024).toFixed(1);
            const cp1y = (tileOffsetY + (b.cp1.y / TILE_UNITS) * 1024).toFixed(1);
            const cp2x = (tileOffsetX + (b.cp2.x / TILE_UNITS) * 1024).toFixed(1);
            const cp2y = (tileOffsetY + (b.cp2.y / TILE_UNITS) * 1024).toFixed(1);
            const p1x = (tileOffsetX + (b.p1.x / TILE_UNITS) * 1024).toFixed(1);
            const p1y = (tileOffsetY + (b.p1.y / TILE_UNITS) * 1024).toFixed(1);
            d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1x} ${p1y}`;
          }
          pathStrings.push(
            `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidthSvg.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" />`
          );
        }
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">
  <rect width="100%" height="100%" fill="${CANVAS_BG_COLOR}" />
  ${pathStrings.join('\n  ')}
</svg>`;
  }
}
