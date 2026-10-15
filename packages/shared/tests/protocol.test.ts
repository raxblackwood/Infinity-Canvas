import { describe, it, expect } from 'vitest';
import {
  encodeClientHello,
  decodeClientHello,
  encodeClientSubscribe,
  decodeClientSubscribe,
  encodeClientStrokeCommit,
  decodeClientStrokeCommit,
  encodeServerWelcome,
  decodeServerWelcome,
  encodeServerTileDelta,
  decodeServerTileDelta,
  encodeServerStrokeAck,
  decodeServerStrokeAck,
  encodeClientStrokeBegin,
  decodeClientStrokeBegin,
  encodeClientStrokePreview,
  decodeClientStrokePreview,
  encodeServerLiveBegin,
  decodeServerLiveBegin,
  encodeServerLivePoints,
  decodeServerLivePoints,
  encodeServerLiveEnd,
  decodeServerLiveEnd,
} from '../src/index.js';

describe('protocol binary codecs', () => {
  it('round-trips HELLO message', () => {
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const buf = encodeClientHello(token, 1);
    const decoded = decodeClientHello(buf);
    expect(decoded.token).toBe(token);
    expect(decoded.clientVersion).toBe(1);
  });

  it('round-trips SUBSCRIBE message', () => {
    const tiles = [
      { tileX: 0, tileY: 0, sinceStrokeId: 0, live: true },
      { tileX: -10, tileY: 42, sinceStrokeId: 5892, live: false },
    ];
    const buf = encodeClientSubscribe(tiles);
    const decoded = decodeClientSubscribe(buf);
    expect(decoded.tiles).toEqual(tiles);
  });

  it('round-trips STROKE_COMMIT message', () => {
    const strokeBytes = new Uint8Array([1, 3, 2, 5, 10, 20, 30, 40]);
    const buf = encodeClientStrokeCommit(12345, -5, 10, strokeBytes);
    const decoded = decodeClientStrokeCommit(buf);
    expect(decoded.clientStrokeId).toBe(12345);
    expect(decoded.tileX).toBe(-5);
    expect(decoded.tileY).toBe(10);
    expect(decoded.strokeBytes).toEqual(strokeBytes);
  });

  it('round-trips WELCOME message', () => {
    const welcome = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      inkBurst: 100,
      inkBalance: 85,
      serverTime: 1718000000000,
      readOnly: false,
    };
    const buf = encodeServerWelcome(welcome);
    const decoded = decodeServerWelcome(buf);
    expect(decoded.userId).toBe(welcome.userId);
    expect(decoded.inkBurst).toBe(welcome.inkBurst);
    expect(decoded.inkBalance).toBe(welcome.inkBalance);
    expect(decoded.readOnly).toBe(false);
  });

  it('round-trips TILE_DELTA message', () => {
    const strokes = [
      { id: 1, strokeBytes: new Uint8Array([1, 2, 3]) },
      { id: 2, strokeBytes: new Uint8Array([4, 5, 6, 7]) },
    ];
    const buf = encodeServerTileDelta(2, -3, strokes);
    const decoded = decodeServerTileDelta(buf);
    expect(decoded.tileX).toBe(2);
    expect(decoded.tileY).toBe(-3);
    expect(decoded.strokes).toEqual(strokes);
  });

  it('round-trips STROKE_ACK message', () => {
    const buf = encodeServerStrokeAck(42, 9999, 90);
    const decoded = decodeServerStrokeAck(buf);
    expect(decoded.clientStrokeId).toBe(42);
    expect(decoded.serverStrokeId).toBe(9999);
    expect(decoded.inkBalance).toBe(90);
  });

  it('round-trips live preview messages (STROKE_BEGIN, STROKE_PREVIEW, LIVE_POINTS, LIVE_END)', () => {
    // Client stroke begin
    const beginBuf = encodeClientStrokeBegin(100, 1, 2, 3, 4);
    const beginDec = decodeClientStrokeBegin(beginBuf);
    expect(beginDec.clientStrokeId).toBe(100);
    expect(beginDec.tileX).toBe(1);
    expect(beginDec.tileY).toBe(2);
    expect(beginDec.colorIndex).toBe(3);
    expect(beginDec.widthIndex).toBe(4);

    // Client stroke preview points
    const pts = [{ x: 100, y: 200 }, { x: 105, y: 210 }, { x: 110, y: 215 }];
    const prevBuf = encodeClientStrokePreview(100, pts);
    const prevDec = decodeClientStrokePreview(prevBuf);
    expect(prevDec.clientStrokeId).toBe(100);
    expect(prevDec.points).toEqual(pts);

    // Server live begin
    const sBeginBuf = encodeServerLiveBegin(1, 2, 999, 3, 4);
    const sBeginDec = decodeServerLiveBegin(sBeginBuf);
    expect(sBeginDec.liveId).toBe(999);

    // Server live points
    const sPtsBuf = encodeServerLivePoints(999, pts);
    const sPtsDec = decodeServerLivePoints(sPtsBuf);
    expect(sPtsDec.liveId).toBe(999);
    expect(sPtsDec.points).toEqual(pts);

    // Server live end
    const sEndBuf = encodeServerLiveEnd(999, 54321);
    const sEndDec = decodeServerLiveEnd(sEndBuf);
    expect(sEndDec.liveId).toBe(999);
    expect(sEndDec.serverStrokeId).toBe(54321);
  });
});
