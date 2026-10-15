import { describe, it, expect } from 'vitest';
import {
  normalizeTileUnits,
  screenToTilePosition,
  tilePositionToScreen,
  getZoomQuantization,
  getCellsPerTileAxis,
  getCellSizeUnits,
  TILE_UNITS,
  VECTOR_MIN_SCALE,
  MAX_SCALE,
} from '../src/index.js';

describe('coordinates', () => {
  it('normalizes tile units within 0..65535 and handles tile overflow/underflow', () => {
    // Exact center
    const p1 = normalizeTileUnits(0, 0, 32768, 32768);
    expect(p1).toEqual({ tileX: 0, tileY: 0, x: 32768, y: 32768 });

    // Positive overflow
    const p2 = normalizeTileUnits(5, -3, 65536 + 100, 131072 + 200);
    expect(p2).toEqual({ tileX: 6, tileY: -1, x: 100, y: 200 });

    // Negative underflow
    const p3 = normalizeTileUnits(10, 20, -50, -65536 - 100);
    expect(p3).toEqual({ tileX: 9, tileY: 18, x: TILE_UNITS - 50, y: TILE_UNITS - 100 });
  });

  it('preserves camera math precision with zero precision loss far from origin', () => {
    // Test at extreme tile coordinates (1,000,000, 2,000,000)
    const camera = {
      tileX: 1_000_000,
      tileY: -2_000_000,
      offsetX: 0.25,
      offsetY: 0.75,
      scale: 2048,
    };
    const viewport = { width: 1000, height: 800, dpr: 2 };

    // Center of screen should map to exactly camera center
    const centerTilePos = screenToTilePosition(500, 400, camera, viewport);
    expect(centerTilePos.tileX).toBe(1_000_000);
    expect(centerTilePos.tileY).toBe(-2_000_000);
    expect(Math.abs(centerTilePos.x - Math.round(0.25 * TILE_UNITS))).toBeLessThanOrEqual(1);
    expect(Math.abs(centerTilePos.y - Math.round(0.75 * TILE_UNITS))).toBeLessThanOrEqual(1);

    // Round-trip from screen to tile to screen
    const screenX = 350;
    const screenY = 620;
    const tilePos = screenToTilePosition(screenX, screenY, camera, viewport);
    const roundTripScreen = tilePositionToScreen(tilePos.tileX, tilePos.tileY, tilePos.x, tilePos.y, camera, viewport);

    expect(Math.abs(roundTripScreen.x - screenX)).toBeLessThan(0.05);
    expect(Math.abs(roundTripScreen.y - screenY)).toBeLessThan(0.05);
  });

  it('enforces vector render cells only for scale >= VECTOR_MIN_SCALE and zq >= 9', () => {
    // Below VECTOR_MIN_SCALE (512) returns null (no render cells below 512 until Phase 2 raster pyramid)
    expect(getZoomQuantization(256, 1)).toBeNull();
    expect(getZoomQuantization(511.9, 2)).toBeNull();

    // At VECTOR_MIN_SCALE (512) with dpr=1: log2(512) = 9
    expect(getZoomQuantization(512, 1)).toBe(9);
    expect(getCellsPerTileAxis(9)).toBe(1);
    expect(getCellSizeUnits(9)).toBe(TILE_UNITS);

    // At DEFAULT_SCALE (2048) with dpr=1: log2(2048) = 11
    expect(getZoomQuantization(2048, 1)).toBe(11);
    expect(getCellsPerTileAxis(11)).toBe(4);
    expect(getCellSizeUnits(11)).toBe(TILE_UNITS / 4);

    // At MAX_SCALE (16384) with dpr=2: ceil(log2(16384 * 2)) = 15
    expect(getZoomQuantization(16384, 2)).toBe(15);
    expect(getCellsPerTileAxis(15)).toBe(64);
  });
});
