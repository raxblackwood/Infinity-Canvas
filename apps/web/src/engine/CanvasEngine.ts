import { Camera } from './Camera.js';
import { CanvasRenderer, PerformanceStats } from './CanvasRenderer.js';
import { PointerCapture, InteractionMode } from './PointerCapture.js';
import { StoredStroke } from './SpatialIndex.js';
import { NetworkClient } from './NetworkClient.js';
import { encodeStroke } from '@infinite-canvas/shared';

export interface CanvasEngineCallbacks {
  onStatsUpdate?: (stats: PerformanceStats) => void;
  onStrokeCommitted?: (stroke: StoredStroke) => void;
  onConnectionChange?: (connected: boolean) => void;
  onTileSelectionChange?: (tiles: { tileX: number; tileY: number }[]) => void;
  onCameraChange?: (camera: { tileX: number; tileY: number; offsetX: number; offsetY: number; scale: number }) => void;
}

export class CanvasEngine {
  readonly camera: Camera;
  readonly renderer: CanvasRenderer;
  readonly pointer: PointerCapture;
  readonly network: NetworkClient;

  private rafId: number | null = null;
  private isRunning = false;
  private readonly callbacks: CanvasEngineCallbacks;

  constructor(canvas: HTMLCanvasElement, callbacks: CanvasEngineCallbacks = {}) {
    this.callbacks = callbacks;

    const isMobile =
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);

    this.camera = new Camera();
    this.renderer = new CanvasRenderer(canvas, this.camera, Boolean(isMobile));
    this.network = new NetworkClient(this);
    this.network.onConnectionChange = (connected) => {
      this.callbacks.onConnectionChange?.(connected);
    };
    this.renderer.remoteLiveStrokesProvider = () => this.network.getRemoteLiveStrokes();

    this.pointer = new PointerCapture(canvas, this.camera, this.renderer, {
      onStrokeCommitted: (stroke) => {
        try {
          const strokeBytes = encodeStroke(stroke.colorIndex, stroke.widthIndex, stroke.points);
          this.network.sendStrokeCommit(stroke.id, stroke.tileX, stroke.tileY, strokeBytes);
        } catch (err) {
          console.error('Failed to encode stroke for network commit:', err);
        }
        this.callbacks.onStrokeCommitted?.(stroke);
      },
      onCameraChanged: () => {
        this.renderer.markDirty();
        this.network.syncVisibleTiles();
        this.callbacks.onCameraChange?.({
          tileX: this.camera.tileX,
          tileY: this.camera.tileY,
          offsetX: this.camera.offsetX,
          offsetY: this.camera.offsetY,
          scale: this.camera.scale,
        });
      },
      onSelectionBoxChanged: (box) => {
        this.renderer.setSelectionMarquee(box);
      },
      onTileClicked: (tileX, tileY) => {
        this.toggleTileSelection(tileX, tileY);
      },
      onTileRangeSelected: (minTx, minTy, maxTx, maxTy) => {
        this.addTileSelectionRange(minTx, minTy, maxTx, maxTy);
      },
    });

    window.addEventListener('resize', this.onResize);
    this.startLoop();
  }

  private onResize = (): void => {
    this.renderer.updateViewport();
  };

  private startLoop(): void {
    this.isRunning = true;
    const loop = (): void => {
      if (!this.isRunning) return;

      // Always render if dirty or live stroke active
      const stats = this.renderer.render();
      this.callbacks.onStatsUpdate?.(stats);

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  setMode(mode: InteractionMode): void {
    this.pointer.mode = mode;
  }

  setDrawingEnabled(enabled: boolean): void {
    this.pointer.isDrawingEnabled = enabled;
  }

  setColor(index: number): void {
    this.pointer.currentColorIndex = index;
  }

  setWidth(index: number): void {
    this.pointer.currentWidthIndex = index;
  }

  setScale(scale: number): void {
    this.camera.setScale(scale, this.renderer.getViewport());
    this.renderer.markDirty();
    this.callbacks.onCameraChange?.({
      tileX: this.camera.tileX,
      tileY: this.camera.tileY,
      offsetX: this.camera.offsetX,
      offsetY: this.camera.offsetY,
      scale: this.camera.scale,
    });
  }

  jumpTo(tileX: number, tileY: number, offsetX = 0.5, offsetY = 0.5, scale?: number): void {
    this.camera.tileX = tileX;
    this.camera.tileY = tileY;
    this.camera.offsetX = offsetX;
    this.camera.offsetY = offsetY;
    if (scale !== undefined) {
      this.camera.setScale(scale, this.renderer.getViewport());
    }
    this.renderer.markDirty();
    this.network.syncVisibleTiles();
    this.callbacks.onCameraChange?.({
      tileX: this.camera.tileX,
      tileY: this.camera.tileY,
      offsetX: this.camera.offsetX,
      offsetY: this.camera.offsetY,
      scale: this.camera.scale,
    });
  }

  addPredefinedStroke(stroke: StoredStroke): void {
    this.renderer.addStroke(stroke);
  }

  getSelectedTiles(): { tileX: number; tileY: number }[] {
    const res: { tileX: number; tileY: number }[] = [];
    for (const key of this.renderer.selectedTiles) {
      const [tx, ty] = key.split(',').map(Number);
      res.push({ tileX: tx, tileY: ty });
    }
    return res;
  }

  setSelectedTiles(tiles: { tileX: number; tileY: number }[]): void {
    this.renderer.setSelectedTiles(tiles);
    this.callbacks.onTileSelectionChange?.(this.getSelectedTiles());
  }

  toggleTileSelection(tileX: number, tileY: number): void {
    const key = `${tileX},${tileY}`;
    if (this.renderer.selectedTiles.has(key)) {
      this.renderer.selectedTiles.delete(key);
    } else {
      this.renderer.selectedTiles.add(key);
    }
    this.renderer.markDirty();
    this.callbacks.onTileSelectionChange?.(this.getSelectedTiles());
  }

  addTileSelectionRange(minTx: number, minTy: number, maxTx: number, maxTy: number): void {
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        this.renderer.selectedTiles.add(`${tx},${ty}`);
      }
    }
    this.renderer.markDirty();
    this.callbacks.onTileSelectionChange?.(this.getSelectedTiles());
  }

  clearSelectedTiles(): void {
    this.renderer.selectedTiles.clear();
    this.renderer.selectionMarquee = null;
    this.renderer.markDirty();
    this.callbacks.onTileSelectionChange?.([]);
  }

  destroy(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    window.removeEventListener('resize', this.onResize);
    this.pointer.destroy();
  }
}
