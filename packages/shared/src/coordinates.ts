import { TILE_UNITS, VECTOR_MIN_SCALE, CELL_PX } from './constants.js';

export interface LocalPoint {
  x: number; // uint16: 0..65535
  y: number; // uint16: 0..65535
}

export interface TilePosition {
  tileX: number; // int32
  tileY: number; // int32
  x: number;     // uint16: 0..65535
  y: number;     // uint16: 0..65535
}

export interface CameraState {
  tileX: number;   // int32
  tileY: number;   // int32
  offsetX: number; // float64 in [0, 1)
  offsetY: number; // float64 in [0, 1)
  scale: number;   // CSS px per tile
}

export interface Viewport {
  width: number;  // CSS px
  height: number; // CSS px
  dpr: number;    // devicePixelRatio
}

/**
 * Normalizes an arbitrary tile + float offset into standard tile (int32) and local units (uint16).
 */
export function normalizeTileUnits(tileX: number, tileY: number, unitX: number, unitY: number): TilePosition {
  let tx = Math.floor(tileX);
  let ty = Math.floor(tileY);

  let ux = unitX;
  let uy = unitY;

  if (ux < 0) {
    const shift = Math.floor(ux / TILE_UNITS);
    tx += shift;
    ux -= shift * TILE_UNITS;
  } else if (ux >= TILE_UNITS) {
    const shift = Math.floor(ux / TILE_UNITS);
    tx += shift;
    ux -= shift * TILE_UNITS;
  }

  if (uy < 0) {
    const shift = Math.floor(uy / TILE_UNITS);
    ty += shift;
    uy -= shift * TILE_UNITS;
  } else if (uy >= TILE_UNITS) {
    const shift = Math.floor(uy / TILE_UNITS);
    ty += shift;
    uy -= shift * TILE_UNITS;
  }

  const finalX = Math.min(TILE_UNITS - 1, Math.max(0, Math.round(ux)));
  const finalY = Math.min(TILE_UNITS - 1, Math.max(0, Math.round(uy)));

  return {
    tileX: tx,
    tileY: ty,
    x: finalX,
    y: finalY,
  };
}

/**
 * Converts screen CSS coordinates (e.g. from pointer event) to tile + uint16 local coordinates.
 */
export function screenToTilePosition(
  screenX: number,
  screenY: number,
  camera: CameraState,
  viewport: Viewport
): TilePosition {
  const dx = screenX - viewport.width / 2;
  const dy = screenY - viewport.height / 2;

  const deltaTilesX = dx / camera.scale;
  const deltaTilesY = dy / camera.scale;

  const rawTileX = camera.tileX + camera.offsetX + deltaTilesX;
  const rawTileY = camera.tileY + camera.offsetY + deltaTilesY;

  const tx = Math.floor(rawTileX);
  const ty = Math.floor(rawTileY);

  const localX = (rawTileX - tx) * TILE_UNITS;
  const localY = (rawTileY - ty) * TILE_UNITS;

  return normalizeTileUnits(tx, ty, localX, localY);
}

/**
 * Converts a tile-local point to screen CSS coordinates relative to the current camera.
 */
export function tilePositionToScreen(
  tx: number,
  ty: number,
  x: number,
  y: number,
  camera: CameraState,
  viewport: Viewport
): { x: number; y: number } {
  const dtx = tx - camera.tileX;
  const dty = ty - camera.tileY;

  const relX = dtx + (x / TILE_UNITS) - camera.offsetX;
  const relY = dty + (y / TILE_UNITS) - camera.offsetY;

  return {
    x: viewport.width / 2 + relX * camera.scale,
    y: viewport.height / 2 + relY * camera.scale,
  };
}

/**
 * Calculates the zoom quantization level zq for render cells.
 * zq = ceil(log2(scale * devicePixelRatio)).
 * Render cells only apply from VECTOR_MIN_SCALE (512) up to MAX_SCALE (16384).
 * Returns null if below VECTOR_MIN_SCALE.
 */
export function getZoomQuantization(scale: number, dpr: number): number | null {
  if (scale < VECTOR_MIN_SCALE) {
    return null;
  }
  const zq = Math.ceil(Math.log2(scale * dpr));
  // Render-cell math applies for zq >= 9
  return Math.max(9, zq);
}

/**
 * Number of render cells per tile axis at a given zq.
 * For zq >= 9: 2^(zq - 9).
 */
export function getCellsPerTileAxis(zq: number): number {
  if (zq < 9) return 1;
  return Math.pow(2, zq - 9);
}

/**
 * Tile-local units per cell axis at a given zq.
 */
export function getCellSizeUnits(zq: number): number {
  const cellsPerAxis = getCellsPerTileAxis(zq);
  return TILE_UNITS / cellsPerAxis;
}

/**
 * Cache key for a render cell.
 */
export function getCellKey(tx: number, ty: number, zq: number, cellX: number, cellY: number): string {
  return `${tx},${ty},${zq},${cellX},${cellY}`;
}
