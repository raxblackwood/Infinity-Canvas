import {
  SIMPLIFY_EPSILON_CSS_PX,
  TILE_UNITS,
  TilePosition,
  screenToTilePosition,
  simplifyPoints,
  splitFragmentBySize,
  splitPathAtTileBorders,
} from '@infinite-canvas/shared';
import { Camera } from './Camera.js';
import { CanvasRenderer } from './CanvasRenderer.js';
import { StoredStroke } from './SpatialIndex.js';

export type InteractionMode = 'draw' | 'move';

export interface PointerCaptureCallbacks {
  onStrokeCommitted?: (stroke: StoredStroke) => void;
  onCameraChanged?: () => void;
}

export class PointerCapture {
  private readonly element: HTMLElement;
  private readonly camera: Camera;
  private readonly renderer: CanvasRenderer;
  private readonly callbacks: PointerCaptureCallbacks;

  mode: InteractionMode = 'draw';
  currentColorIndex = 0;
  currentWidthIndex = 2; // Default 256 units (~8 CSS px at 2048)

  private isSpaceDown = false;
  private activePointers: Map<number, { x: number; y: number; pointerType: string }> = new Map();
  private initialPinchDist = 0;
  private initialPinchScale = 1;
  private initialPinchCenter = { x: 0, y: 0 };

  // Current drawing stroke
  private drawingPointerId: number | null = null;
  private currentRawPath: TilePosition[] = [];
  private nextLocalStrokeId = 1;

  constructor(
    element: HTMLElement,
    camera: Camera,
    renderer: CanvasRenderer,
    callbacks: PointerCaptureCallbacks = {}
  ) {
    this.element = element;
    this.camera = camera;
    this.renderer = renderer;
    this.callbacks = callbacks;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerUp);
    this.element.addEventListener('wheel', this.onWheel, { passive: false });

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  destroy(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('wheel', this.onWheel);

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !this.isSpaceDown) {
      this.isSpaceDown = true;
      this.element.style.cursor = 'grab';
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.isSpaceDown = false;
      this.element.style.cursor = 'default';
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.camera.zoomAt(factor, e.clientX, e.clientY, this.renderer.getViewport());
    this.renderer.markDirty();
    this.callbacks.onCameraChanged?.();
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Palm rejection: ignore large touch contact while pen active
    if (e.pointerType === 'touch' && (e.width > 50 || e.height > 50)) {
      return;
    }

    this.activePointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
    });
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {}

    // Two-finger pinch init
    if (this.activePointers.size === 2) {
      // Cancel active drawing if second finger lands
      if (this.drawingPointerId !== null) {
        this.drawingPointerId = null;
        this.currentRawPath = [];
        this.renderer.setActiveLiveStroke(null);
      }
      const [p1, p2] = Array.from(this.activePointers.values());
      this.initialPinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      this.initialPinchScale = this.camera.scale;
      this.initialPinchCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      return;
    }

    if (this.activePointers.size === 1) {
      const isPanGesture =
        this.mode === 'move' ||
        this.isSpaceDown ||
        e.button === 1 || // Middle mouse
        (e.pointerType === 'mouse' && e.button !== 0);

      if (!isPanGesture) {
        // Start drawing
        this.drawingPointerId = e.pointerId;
        this.currentRawPath = [];

        const viewport = this.renderer.getViewport();
        const tilePos = screenToTilePosition(e.clientX, e.clientY, this.camera, viewport);
        this.currentRawPath.push(tilePos);

        this.renderer.setActiveLiveStroke({
          tileX: tilePos.tileX,
          tileY: tilePos.tileY,
          colorIndex: this.currentColorIndex,
          widthIndex: this.currentWidthIndex,
          points: [{ x: tilePos.x, y: tilePos.y }],
        });
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.activePointers.get(e.pointerId);
    if (!prev) return;

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.activePointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
    });

    // 2-finger Pan & Pinch-zoom
    if (this.activePointers.size === 2) {
      const [p1, p2] = Array.from(this.activePointers.values());
      const curDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const curCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      // Pan from center shift
      const centerDx = curCenter.x - this.initialPinchCenter.x;
      const centerDy = curCenter.y - this.initialPinchCenter.y;
      this.camera.pan(centerDx, centerDy);
      this.initialPinchCenter = curCenter;

      // Pinch zoom
      if (this.initialPinchDist > 10 && curDist > 10) {
        const factor = curDist / this.initialPinchDist;
        const targetScale = this.initialPinchScale * factor;
        const zoomRatio = targetScale / this.camera.scale;
        this.camera.zoomAt(zoomRatio, curCenter.x, curCenter.y, this.renderer.getViewport());
      }

      this.renderer.markDirty();
      this.callbacks.onCameraChanged?.();
      return;
    }

    // 1-finger Move or Space-drag
    if (this.activePointers.size === 1) {
      const isPan =
        this.mode === 'move' ||
        this.isSpaceDown ||
        (e.pointerType === 'mouse' && (e.buttons === 4 || e.buttons === 2));

      if (isPan) {
        this.camera.pan(dx, dy);
        this.renderer.markDirty();
        this.callbacks.onCameraChanged?.();
        return;
      }

      // Drawing active
      if (this.drawingPointerId === e.pointerId) {
        const viewport = this.renderer.getViewport();

        // Use coalesced events if available for high-fidelity capture
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
        for (const evt of events) {
          const tilePos = screenToTilePosition(evt.clientX, evt.clientY, this.camera, viewport);
          this.currentRawPath.push(tilePos);
        }

        // Live stroke preview
        const first = this.currentRawPath[0];
        const previewPoints = this.currentRawPath.map((p) => {
          // Express points in first tile space for live display
          const dtx = p.tileX - first.tileX;
          const dty = p.tileY - first.tileY;
          return {
            x: p.x + dtx * TILE_UNITS,
            y: p.y + dty * TILE_UNITS,
          };
        });

        this.renderer.setActiveLiveStroke({
          tileX: first.tileX,
          tileY: first.tileY,
          colorIndex: this.currentColorIndex,
          widthIndex: this.currentWidthIndex,
          points: previewPoints,
        });
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture already released
    }

    if (this.drawingPointerId === e.pointerId) {
      this.drawingPointerId = null;
      this.renderer.setActiveLiveStroke(null);
      this.commitCurrentStroke();
    }
  };

  private commitCurrentStroke(): void {
    if (this.currentRawPath.length === 0) return;

    // 1. Split path at tile borders
    const fragments = splitPathAtTileBorders(this.currentRawPath);

    // 2. Simplify each fragment with Ramer-Douglas-Peucker (SIMPLIFY_EPSILON)
    const epsilonUnits = (SIMPLIFY_EPSILON_CSS_PX / this.camera.scale) * TILE_UNITS;

    for (const frag of fragments) {
      const simplified = simplifyPoints(frag.points, Math.max(1, epsilonUnits));

      // 3. If exceeding MAX_POINTS, split into consecutive fragments sharing a point
      const chunks = splitFragmentBySize(simplified);

      for (const pts of chunks) {
        let minX = pts[0].x;
        let minY = pts[0].y;
        let maxX = pts[0].x;
        let maxY = pts[0].y;

        for (let i = 1; i < pts.length; i++) {
          if (pts[i].x < minX) minX = pts[i].x;
          if (pts[i].y < minY) minY = pts[i].y;
          if (pts[i].x > maxX) maxX = pts[i].x;
          if (pts[i].y > maxY) maxY = pts[i].y;
        }

        const storedStroke: StoredStroke = {
          id: this.nextLocalStrokeId++,
          tileX: frag.tileX,
          tileY: frag.tileY,
          colorIndex: this.currentColorIndex,
          widthIndex: this.currentWidthIndex,
          points: pts,
          minX,
          minY,
          maxX,
          maxY,
        };

        this.renderer.addStroke(storedStroke);
        this.callbacks.onStrokeCommitted?.(storedStroke);
      }
    }

    this.currentRawPath = [];
  }
}
