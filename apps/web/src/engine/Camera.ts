import {
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  TILE_UNITS,
  CameraState,
  Viewport,
  screenToTilePosition,
  tilePositionToScreen,
} from '@infinite-canvas/shared';

export class Camera implements CameraState {
  tileX = 0;
  tileY = 0;
  offsetX = 0.5; // Start in center of tile (0, 0)
  offsetY = 0.5;
  scale = DEFAULT_SCALE;

  constructor(initialScale = DEFAULT_SCALE) {
    this.scale = initialScale;
  }

  /**
   * Pan the camera by screen displacement (dx, dy) in CSS pixels.
   */
  pan(dx: number, dy: number): void {
    // Moving screen by +dx means camera moves -dx
    const deltaTilesX = -dx / this.scale;
    const deltaTilesY = -dy / this.scale;

    this.moveByFractionalTiles(deltaTilesX, deltaTilesY);
  }

  /**
   * Zoom the camera by a factor around a fixed screen point (pivotX, pivotY).
   */
  zoomAt(factor: number, pivotX: number, pivotY: number, viewport: Viewport): void {
    const oldScale = this.scale;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * factor));
    if (newScale === oldScale) return;

    // Get the tile coordinate currently under the pivot point
    const pivotTilePos = screenToTilePosition(pivotX, pivotY, this, viewport);

    // Apply the new scale
    this.scale = newScale;

    // Reposition camera so the pivot point remains at (pivotX, pivotY)
    const newScreen = tilePositionToScreen(
      pivotTilePos.tileX,
      pivotTilePos.tileY,
      pivotTilePos.x,
      pivotTilePos.y,
      this,
      viewport
    );

    const shiftX = pivotX - newScreen.x;
    const shiftY = pivotY - newScreen.y;

    this.pan(shiftX, shiftY);
  }

  /**
   * Directly sets the scale while keeping screen center stationary.
   */
  setScale(newScale: number, viewport: Viewport): void {
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const factor = clampedScale / this.scale;
    this.zoomAt(factor, viewport.width / 2, viewport.height / 2, viewport);
  }

  /**
   * Internal helper to shift camera by fractional tiles and normalize offsets.
   */
  private moveByFractionalTiles(dTx: number, dTy: number): void {
    const rawX = this.tileX + this.offsetX + dTx;
    const rawY = this.tileY + this.offsetY + dTy;

    this.tileX = Math.floor(rawX);
    this.tileY = Math.floor(rawY);

    this.offsetX = rawX - this.tileX;
    this.offsetY = rawY - this.tileY;

    // Safeguard edge precision
    if (this.offsetX >= 1) {
      this.tileX += Math.floor(this.offsetX);
      this.offsetX -= Math.floor(this.offsetX);
    } else if (this.offsetX < 0) {
      const shift = Math.floor(this.offsetX);
      this.tileX += shift;
      this.offsetX -= shift;
    }

    if (this.offsetY >= 1) {
      this.tileY += Math.floor(this.offsetY);
      this.offsetY -= Math.floor(this.offsetY);
    } else if (this.offsetY < 0) {
      const shift = Math.floor(this.offsetY);
      this.tileY += shift;
      this.offsetY -= shift;
    }
  }
}
