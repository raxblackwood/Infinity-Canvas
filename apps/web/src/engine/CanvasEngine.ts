import { Camera } from './Camera.js';
import { CanvasRenderer, PerformanceStats } from './CanvasRenderer.js';
import { PointerCapture, InteractionMode } from './PointerCapture.js';
import { StoredStroke } from './SpatialIndex.js';

export interface CanvasEngineCallbacks {
  onStatsUpdate?: (stats: PerformanceStats) => void;
  onStrokeCommitted?: (stroke: StoredStroke) => void;
}

export class CanvasEngine {
  readonly camera: Camera;
  readonly renderer: CanvasRenderer;
  readonly pointer: PointerCapture;

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
    this.pointer = new PointerCapture(canvas, this.camera, this.renderer, {
      onStrokeCommitted: (stroke) => {
        this.callbacks.onStrokeCommitted?.(stroke);
      },
      onCameraChanged: () => {
        this.renderer.markDirty();
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

  setColor(index: number): void {
    this.pointer.currentColorIndex = index;
  }

  setWidth(index: number): void {
    this.pointer.currentWidthIndex = index;
  }

  setScale(scale: number): void {
    this.camera.setScale(scale, this.renderer.getViewport());
    this.renderer.markDirty();
  }

  addPredefinedStroke(stroke: StoredStroke): void {
    this.renderer.addStroke(stroke);
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
