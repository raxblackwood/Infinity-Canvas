import { describe, it, expect } from 'vitest';
import {
  encodeVarint,
  decodeVarint,
  encodeZigZag,
  decodeZigZag,
  encodeStroke,
  decodeStroke,
  LocalPoint,
  MAX_POINTS,
} from '../src/index.js';

describe('codec', () => {
  it('round-trips varint encoding for small and large values', () => {
    const values = [0, 1, 127, 128, 255, 16384, 65535, 1_000_000, 2 ** 32 - 1];
    for (const val of values) {
      const bytes = new Uint8Array(encodeVarint(val));
      const state = { offset: 0 };
      const decoded = decodeVarint(bytes, state);
      expect(decoded).toBe(val);
      expect(state.offset).toBe(bytes.length);
    }
  });

  it('round-trips zigzag encoding for negative and positive integers', () => {
    const values = [0, -1, 1, -2, 2, -1000, 1000, -32768, 32767, -65536, 65536];
    for (const val of values) {
      const encoded = encodeZigZag(val);
      expect(encoded).toBeGreaterThanOrEqual(0);
      const decoded = decodeZigZag(encoded);
      expect(decoded).toBe(val);
    }
  });

  it('round-trips a 1-point stroke', () => {
    const points: LocalPoint[] = [{ x: 32000, y: 15000 }];
    const bytes = encodeStroke(3, 2, points);
    const decoded = decodeStroke(bytes);

    expect(decoded.version).toBe(1);
    expect(decoded.colorIndex).toBe(3);
    expect(decoded.widthIndex).toBe(2);
    expect(decoded.points).toEqual(points);
  });

  it('round-trips a 512-point stroke (MAX_POINTS)', () => {
    const points: LocalPoint[] = [];
    let curX = 1000;
    let curY = 1000;
    points.push({ x: curX, y: curY });

    for (let i = 1; i < MAX_POINTS; i++) {
      curX = (curX + 50) % 65000;
      curY = (curY + 30) % 65000;
      points.push({ x: curX, y: curY });
    }

    const bytes = encodeStroke(15, 5, points);
    const decoded = decodeStroke(bytes);

    expect(decoded.colorIndex).toBe(15);
    expect(decoded.widthIndex).toBe(5);
    expect(decoded.points).toHaveLength(MAX_POINTS);
    expect(decoded.points).toEqual(points);
  });

  it('round-trips extreme deltas across uint16 coordinates', () => {
    const points: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 65535, y: 65535 },
      { x: 0, y: 65535 },
      { x: 65535, y: 0 },
    ];
    const bytes = encodeStroke(0, 0, points);
    const decoded = decodeStroke(bytes);
    expect(decoded.points).toEqual(points);
  });

  it('rejects invalid inputs', () => {
    // 0 points
    expect(() => encodeStroke(0, 0, [])).toThrow();
    // > 512 points
    const tooMany = Array.from({ length: 513 }, () => ({ x: 0, y: 0 }));
    expect(() => encodeStroke(0, 0, tooMany)).toThrow();
    // Invalid color
    expect(() => encodeStroke(16, 0, [{ x: 0, y: 0 }])).toThrow();
    // Invalid width
    expect(() => encodeStroke(0, 6, [{ x: 0, y: 0 }])).toThrow();
  });
});
