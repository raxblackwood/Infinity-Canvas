// Coordinate and Zoom Constants
export const TILE_UNITS = 65536; // Local coordinates per tile axis (uint16: 0..65535)
export const DEFAULT_SCALE = 2048; // CSS pixels per tile at default zoom
export const MAX_SCALE = 16384; // Deepest zoom in
export const MIN_SCALE = 0.0625; // Farthest zoom out (world overview)
export const VECTOR_MIN_SCALE = 512; // At or above this: vector mode. Below: raster mode

// Rendering & Geometry Constants
export const RASTER_TILE_PX = 1024; // Pyramid image size (Level k covers 2^k x 2^k tiles)
export const PYRAMID_MAX_LEVEL = 12;
export const CELL_PX = 512; // Render cell bitmap size in device pixels
export const BRUSH_WIDTHS = [64, 128, 256, 512, 1024, 2048] as const; // in tile units (2 to 64 CSS px at DEFAULT_SCALE)
export const MAX_POINTS = 512; // Per stroke fragment, after simplification
export const SIMPLIFY_EPSILON_CSS_PX = 0.5; // In CSS px, converted to local units based on capture scale
export const TILE_STROKE_CAP = 20000; // Stroke cap per tile before freezing

// Timing & Network Constants
export const PREVIEW_CHUNK_MS = 50; // Client sends preview point chunks
export const BROADCAST_BATCH_MS = 100; // Server batches live points per tile
export const MAX_SUBSCRIBED_TILES = 64; // Per client
export const MAX_LIVE_SUBSCRIBERS_PER_TILE = 200; // Extra viewers get deltas only
export const MAX_WS_MESSAGE = 16 * 1024; // 16 KB
export const UNDO_WINDOW_MS = 30 * 1000; // 30 s
export const BAKE_DEBOUNCE_MS = 5 * 1000; // 5 s
export const BAKE_MAX_MS = 60 * 1000; // 60 s
export const PARENT_REBAKE_DEBOUNCE_MS = 30 * 1000; // 30 s

// Ink Limits
export const INK_BURST = 100;
export const INK_REFILL_INTERVAL_MS = 2000; // 1 unit per 2 seconds
export const INK_REFILL_PER_SEC = 0.5;

// Cache Budgets in bytes
export const BITMAP_CACHE_MOBILE = 96 * 1024 * 1024; // 96 MB
export const BITMAP_CACHE_DESKTOP = 256 * 1024 * 1024; // 256 MB

// Visual Design
export const CANVAS_BG_COLOR = '#FBFAF7';

// 16-Color Palette (Appendix A)
export interface PaletteColor {
  index: number;
  name: string;
  hex: string;
}

export const PALETTE: readonly PaletteColor[] = [
  { index: 0, name: 'Black', hex: '#1A1A1A' },
  { index: 1, name: 'Gray', hex: '#6B6B6B' },
  { index: 2, name: 'White', hex: '#FFFFFF' },
  { index: 3, name: 'Red', hex: '#E53935' },
  { index: 4, name: 'Orange', hex: '#FB8C00' },
  { index: 5, name: 'Yellow', hex: '#FDD835' },
  { index: 6, name: 'Green', hex: '#7CB342' },
  { index: 7, name: 'Teal', hex: '#00897B' },
  { index: 8, name: 'Blue', hex: '#1E88E5' },
  { index: 9, name: 'Indigo', hex: '#3949AB' },
  { index: 10, name: 'Purple', hex: '#8E24AA' },
  { index: 11, name: 'Pink', hex: '#D81B60' },
  { index: 12, name: 'Brown', hex: '#8D6E63' },
  { index: 13, name: 'Peach', hex: '#F4C7A1' },
  { index: 14, name: 'Sky', hex: '#81D4FA' },
  { index: 15, name: 'Mint', hex: '#A5D6A7' },
] as const;

// Error Codes (Appendix B)
export enum ErrorCode {
  RATE_LIMIT = 1,
  INK_EMPTY = 2,
  TILE_FULL = 3,
  BAD_STROKE = 4,
  OUT_OF_RANGE = 5,
  BANNED = 6,
  READ_ONLY = 7,
  SERVER_BUSY = 8,
  UNAUTHORIZED = 9,
}
