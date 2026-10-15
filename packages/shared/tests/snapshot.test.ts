import { describe, it, expect } from 'vitest';
import { encodeTileSnapshot, decodeTileSnapshot, TileSnapshot } from '../src/snapshot.js';
import { encodeStroke } from '../src/codec.js';

describe('ICT1 Snapshot Codec', () => {
  it('encodes and decodes an empty tile snapshot', () => {
    const original: TileSnapshot = {
      tileX: -5,
      tileY: 42,
      version: 1,
      maxStrokeId: 0,
      strokeCount: 0,
      strokes: [],
    };

    const encoded = encodeTileSnapshot(original);
    expect(encoded.length).toBeGreaterThanOrEqual(16);
    expect(encoded[0]).toBe(0x49); // I
    expect(encoded[1]).toBe(0x43); // C
    expect(encoded[2]).toBe(0x54); // T
    expect(encoded[3]).toBe(0x31); // 1

    const decoded = decodeTileSnapshot(encoded);
    expect(decoded.tileX).toBe(-5);
    expect(decoded.tileY).toBe(42);
    expect(decoded.version).toBe(1);
    expect(decoded.maxStrokeId).toBe(0);
    expect(decoded.strokeCount).toBe(0);
    expect(decoded.strokes).toEqual([]);
  });

  it('encodes and decodes a snapshot with multiple strokes and preserves order', () => {
    const stroke1 = encodeStroke(2, 1, [{ x: 100, y: 200 }, { x: 300, y: 400 }]);
    const stroke2 = encodeStroke(5, 3, [{ x: 500, y: 600 }, { x: 700, y: 800 }, { x: 900, y: 1000 }]);

    const original: TileSnapshot = {
      tileX: 10,
      tileY: -20,
      version: 4,
      maxStrokeId: 200,
      strokeCount: 2,
      strokes: [
        { id: 100, data: stroke1 },
        { id: 200, data: stroke2 },
      ],
    };

    const encoded = encodeTileSnapshot(original);
    const decoded = decodeTileSnapshot(encoded);

    expect(decoded.tileX).toBe(10);
    expect(decoded.tileY).toBe(-20);
    expect(decoded.version).toBe(4);
    expect(decoded.maxStrokeId).toBe(200);
    expect(decoded.strokeCount).toBe(2);
    expect(decoded.strokes.length).toBe(2);

    expect(decoded.strokes[0].id).toBe(100);
    expect(new Uint8Array(decoded.strokes[0].data)).toEqual(stroke1);

    expect(decoded.strokes[1].id).toBe(200);
    expect(new Uint8Array(decoded.strokes[1].data)).toEqual(stroke2);
  });

  it('rejects corrupt buffer with invalid magic', () => {
    const corrupt = new Uint8Array(20);
    expect(() => decodeTileSnapshot(corrupt)).toThrow('Invalid snapshot magic');
  });

  it('rejects truncated buffer', () => {
    const short = new Uint8Array(10);
    expect(() => decodeTileSnapshot(short)).toThrow('Buffer too short');
  });
});
