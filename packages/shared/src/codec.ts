import { LocalPoint } from './coordinates.js';
import { MAX_POINTS } from './constants.js';

export interface DecodedStroke {
  version: number;
  colorIndex: number;
  widthIndex: number;
  points: LocalPoint[];
}

/**
 * Encodes an unsigned integer as a protobuf-style varint.
 */
export function encodeVarint(value: number, out: number[] = []): number[] {
  let v = Math.floor(value);
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
  return out;
}

/**
 * Decodes an unsigned varint from a byte buffer.
 */
export function decodeVarint(buffer: Uint8Array, state: { offset: number }): number {
  let result = 0;
  let shift = 0;

  while (state.offset < buffer.length) {
    const byte = buffer[state.offset++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) {
      return result;
    }
    shift += 7;
    if (shift > 53) {
      throw new Error('Varint overflow');
    }
  }

  throw new Error('Unexpected end of buffer while decoding varint');
}

/**
 * ZigZag encoding maps signed integers to unsigned integers:
 * 0 -> 0, -1 -> 1, 1 -> 2, -2 -> 3, 2 -> 4, etc.
 */
export function encodeZigZag(n: number): number {
  return (n << 1) ^ (n >> 31);
}

export function decodeZigZag(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

/**
 * Encodes a stroke fragment into binary bytes (format v1).
 */
export function encodeStroke(colorIndex: number, widthIndex: number, points: readonly LocalPoint[]): Uint8Array {
  if (points.length === 0 || points.length > MAX_POINTS) {
    throw new Error(`Point count ${points.length} out of bounds (1..${MAX_POINTS})`);
  }
  if (colorIndex < 0 || colorIndex > 15) {
    throw new Error(`Color index ${colorIndex} out of bounds (0..15)`);
  }
  if (widthIndex < 0 || widthIndex > 5) {
    throw new Error(`Width index ${widthIndex} out of bounds (0..5)`);
  }

  const bytes: number[] = [];
  // byte 0: version 1
  bytes.push(1);
  // byte 1: color index 0-15
  bytes.push(colorIndex & 0x0f);
  // byte 2: width index 0-5
  bytes.push(widthIndex & 0x07);

  // varint point count
  encodeVarint(points.length, bytes);

  // u16 x, u16 y for first point (little-endian)
  const p0 = points[0];
  bytes.push(p0.x & 0xff, (p0.x >> 8) & 0xff);
  bytes.push(p0.y & 0xff, (p0.y >> 8) & 0xff);

  // N-1 deltas: zigzag varint dx, zigzag varint dy
  let prevX = p0.x;
  let prevY = p0.y;

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const dx = pt.x - prevX;
    const dy = pt.y - prevY;

    encodeVarint(encodeZigZag(dx), bytes);
    encodeVarint(encodeZigZag(dy), bytes);

    prevX = pt.x;
    prevY = pt.y;
  }

  return new Uint8Array(bytes);
}

/**
 * Decodes a stroke from binary bytes (format v1).
 */
export function decodeStroke(buffer: Uint8Array, offset = 0): DecodedStroke {
  const state = { offset };
  if (buffer.length - state.offset < 7) {
    throw new Error('Buffer too small for stroke header');
  }

  const version = buffer[state.offset++];
  if (version !== 1) {
    throw new Error(`Unsupported stroke format version: ${version}`);
  }

  const colorIndex = buffer[state.offset++];
  const widthIndex = buffer[state.offset++];

  const pointCount = decodeVarint(buffer, state);
  if (pointCount < 1 || pointCount > MAX_POINTS) {
    throw new Error(`Decoded point count ${pointCount} out of bounds (1..${MAX_POINTS})`);
  }

  const points: LocalPoint[] = [];

  // First point
  if (buffer.length - state.offset < 4) {
    throw new Error('Buffer too small for first point');
  }
  const x0 = buffer[state.offset++] | (buffer[state.offset++] << 8);
  const y0 = buffer[state.offset++] | (buffer[state.offset++] << 8);
  points.push({ x: x0, y: y0 });

  let curX = x0;
  let curY = y0;

  for (let i = 1; i < pointCount; i++) {
    const zzDx = decodeVarint(buffer, state);
    const zzDy = decodeVarint(buffer, state);

    const dx = decodeZigZag(zzDx);
    const dy = decodeZigZag(zzDy);

    curX += dx;
    curY += dy;

    points.push({ x: curX, y: curY });
  }

  return {
    version,
    colorIndex,
    widthIndex,
    points,
  };
}
