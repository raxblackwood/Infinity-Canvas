import { decodeVarint, encodeVarint, encodeZigZag, decodeZigZag } from './codec.js';
import { LocalPoint } from './coordinates.js';

// WebSocket Message Types (SPEC Section 5)
export enum WsMessageType {
  // Client -> Server
  HELLO = 0x01,
  SUBSCRIBE = 0x02,
  UNSUBSCRIBE = 0x03,
  STROKE_BEGIN = 0x04,
  STROKE_PREVIEW = 0x05,
  STROKE_COMMIT = 0x06,
  STROKE_CANCEL = 0x07,
  UNDO = 0x08,
  PING = 0x0f,

  // Server -> Client
  WELCOME = 0x81,
  TILE_DELTA = 0x82,
  LIVE_BEGIN = 0x83,
  LIVE_POINTS = 0x84,
  LIVE_END = 0x85,
  STROKE_ACK = 0x86,
  STROKE_REJECT = 0x87,
  STROKES_HIDDEN = 0x88,
  TILE_FROZEN = 0x89,
  INK = 0x8a,
  NOTICE = 0x8b,
  PONG = 0x8f,
}

// Data structures
export interface ClientHello {
  token: string; // 64 hex characters or 32 raw bytes
  clientVersion: number;
}

export interface TileSubEntry {
  tileX: number;
  tileY: number;
  sinceStrokeId: number;
  live: boolean;
}

export interface ClientSubscribe {
  tiles: TileSubEntry[];
}

export interface ClientUnsubscribe {
  tiles: { tileX: number; tileY: number }[];
}

export interface ClientStrokeBegin {
  clientStrokeId: number;
  tileX: number;
  tileY: number;
  colorIndex: number;
  widthIndex: number;
}

export interface ClientStrokePreview {
  clientStrokeId: number;
  points: LocalPoint[];
}

export interface ClientStrokeCommit {
  clientStrokeId: number;
  tileX: number;
  tileY: number;
  strokeBytes: Uint8Array;
}

export interface ServerWelcome {
  userId: string;
  inkBurst: number;
  inkBalance: number;
  serverTime: number;
  readOnly: boolean;
}

export interface DeltaStroke {
  id: number;
  strokeBytes: Uint8Array;
}

export interface ServerTileDelta {
  tileX: number;
  tileY: number;
  strokes: DeltaStroke[];
}

export interface ServerLiveBegin {
  tileX: number;
  tileY: number;
  liveId: number;
  colorIndex: number;
  widthIndex: number;
}

export interface ServerLivePoints {
  liveId: number;
  points: LocalPoint[];
}

export interface ServerLiveEnd {
  liveId: number;
  serverStrokeId: number;
}

export interface ServerStrokeAck {
  clientStrokeId: number;
  serverStrokeId: number;
  inkBalance: number;
}

export interface ServerStrokeReject {
  clientStrokeId: number;
  errorCode: number;
}

export interface ServerStrokesHidden {
  tileX: number;
  tileY: number;
  strokeIds: number[];
}

// Binary Encoders & Decoders (Little-Endian)

export function encodeClientHello(tokenHex: string, clientVersion = 1): Uint8Array {
  const bytes = new Uint8Array(1 + 32 + 2);
  bytes[0] = WsMessageType.HELLO;

  // 32-byte token from hex
  for (let i = 0; i < 32; i++) {
    bytes[1 + i] = parseInt(tokenHex.substr(i * 2, 2) || '00', 16);
  }
  // u16 clientVersion
  bytes[33] = clientVersion & 0xff;
  bytes[34] = (clientVersion >> 8) & 0xff;
  return bytes;
}

export function decodeClientHello(buf: Uint8Array): ClientHello {
  if (buf.length < 35 || buf[0] !== WsMessageType.HELLO) {
    throw new Error('Invalid HELLO message length');
  }
  let tokenHex = '';
  for (let i = 1; i <= 32; i++) {
    tokenHex += buf[i].toString(16).padStart(2, '0');
  }
  const clientVersion = buf[33] | (buf[34] << 8);
  return { token: tokenHex, clientVersion };
}

export function encodeClientSubscribe(tiles: TileSubEntry[]): Uint8Array {
  const out: number[] = [WsMessageType.SUBSCRIBE];
  // count u16
  out.push(tiles.length & 0xff, (tiles.length >> 8) & 0xff);

  const view = new DataView(new ArrayBuffer(8));
  for (const t of tiles) {
    view.setInt32(0, t.tileX, true);
    view.setInt32(4, t.tileY, true);
    for (let i = 0; i < 8; i++) out.push(view.getUint8(i));

    encodeVarint(t.sinceStrokeId, out);
    out.push(t.live ? 1 : 0);
  }
  return new Uint8Array(out);
}

export function decodeClientSubscribe(buf: Uint8Array): ClientSubscribe {
  if (buf.length < 3 || buf[0] !== WsMessageType.SUBSCRIBE) {
    throw new Error('Invalid SUBSCRIBE message');
  }
  const count = buf[1] | (buf[2] << 8);
  const state = { offset: 3 };
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tiles: TileSubEntry[] = [];

  for (let i = 0; i < count; i++) {
    const tileX = view.getInt32(state.offset, true);
    const tileY = view.getInt32(state.offset + 4, true);
    state.offset += 8;

    const sinceStrokeId = decodeVarint(buf, state);
    const live = buf[state.offset++] === 1;
    tiles.push({ tileX, tileY, sinceStrokeId, live });
  }

  return { tiles };
}

export function encodeClientStrokeCommit(
  clientStrokeId: number,
  tileX: number,
  tileY: number,
  strokeBytes: Uint8Array
): Uint8Array {
  const out = new Uint8Array(1 + 4 + 8 + strokeBytes.length);
  out[0] = WsMessageType.STROKE_COMMIT;

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(1, clientStrokeId, true);
  view.setInt32(5, tileX, true);
  view.setInt32(9, tileY, true);

  out.set(strokeBytes, 13);
  return out;
}

export function decodeClientStrokeCommit(buf: Uint8Array): ClientStrokeCommit {
  if (buf.length < 13 || buf[0] !== WsMessageType.STROKE_COMMIT) {
    throw new Error('Invalid STROKE_COMMIT message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const clientStrokeId = view.getUint32(1, true);
  const tileX = view.getInt32(5, true);
  const tileY = view.getInt32(9, true);
  const strokeBytes = buf.subarray(13);

  return { clientStrokeId, tileX, tileY, strokeBytes };
}

export function encodeServerWelcome(payload: ServerWelcome): Uint8Array {
  // 1 type + 16 UUID bytes + 2 inkBurst + 2 inkBalance + 8 serverTime + 1 readOnly = 30 bytes
  const out = new Uint8Array(30);
  out[0] = WsMessageType.WELCOME;

  // Clean hex representation of UUID
  const cleanUuid = payload.userId.replace(/-/g, '');
  for (let i = 0; i < 16; i++) {
    out[1 + i] = parseInt(cleanUuid.substr(i * 2, 2) || '00', 16);
  }

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint16(17, payload.inkBurst, true);
  view.setUint16(19, payload.inkBalance, true);
  view.setFloat64(21, payload.serverTime, true);
  out[29] = payload.readOnly ? 1 : 0;

  return out;
}

export function decodeServerWelcome(buf: Uint8Array): ServerWelcome {
  if (buf.length < 30 || buf[0] !== WsMessageType.WELCOME) {
    throw new Error('Invalid WELCOME message');
  }
  let hex = '';
  for (let i = 1; i <= 16; i++) {
    hex += buf[i].toString(16).padStart(2, '0');
  }
  // Reconstruct standard UUID format: 8-4-4-4-12
  const userId = `${hex.substr(0, 8)}-${hex.substr(8, 4)}-${hex.substr(12, 4)}-${hex.substr(16, 4)}-${hex.substr(20, 12)}`;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const inkBurst = view.getUint16(17, true);
  const inkBalance = view.getUint16(19, true);
  const serverTime = view.getFloat64(21, true);
  const readOnly = buf[29] === 1;

  return { userId, inkBurst, inkBalance, serverTime, readOnly };
}

export function encodeServerTileDelta(tileX: number, tileY: number, strokes: DeltaStroke[]): Uint8Array {
  const out: number[] = [WsMessageType.TILE_DELTA];

  const view = new DataView(new ArrayBuffer(8));
  view.setInt32(0, tileX, true);
  view.setInt32(4, tileY, true);
  for (let i = 0; i < 8; i++) out.push(view.getUint8(i));

  encodeVarint(strokes.length, out);

  for (const s of strokes) {
    encodeVarint(s.id, out);
    encodeVarint(s.strokeBytes.length, out);
    for (let i = 0; i < s.strokeBytes.length; i++) {
      out.push(s.strokeBytes[i]);
    }
  }

  return new Uint8Array(out);
}

export function decodeServerTileDelta(buf: Uint8Array): ServerTileDelta {
  if (buf.length < 9 || buf[0] !== WsMessageType.TILE_DELTA) {
    throw new Error('Invalid TILE_DELTA message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tileX = view.getInt32(1, true);
  const tileY = view.getInt32(5, true);

  const state = { offset: 9 };
  const count = decodeVarint(buf, state);
  const strokes: DeltaStroke[] = [];

  for (let i = 0; i < count; i++) {
    const id = decodeVarint(buf, state);
    const len = decodeVarint(buf, state);
    const strokeBytes = buf.slice(state.offset, state.offset + len);
    state.offset += len;
    strokes.push({ id, strokeBytes });
  }

  return { tileX, tileY, strokes };
}

export function encodeServerStrokeAck(clientStrokeId: number, serverStrokeId: number, inkBalance = 100): Uint8Array {
  const out: number[] = [WsMessageType.STROKE_ACK];

  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, clientStrokeId, true);
  for (let i = 0; i < 4; i++) out.push(view.getUint8(i));

  encodeVarint(serverStrokeId, out);

  // inkBalance u16
  out.push(inkBalance & 0xff, (inkBalance >> 8) & 0xff);
  return new Uint8Array(out);
}

export function decodeServerStrokeAck(buf: Uint8Array): ServerStrokeAck {
  if (buf.length < 7 || buf[0] !== WsMessageType.STROKE_ACK) {
    throw new Error('Invalid STROKE_ACK message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const clientStrokeId = view.getUint32(1, true);
  const state = { offset: 5 };
  const serverStrokeId = decodeVarint(buf, state);
  const inkBalance = buf[state.offset] | (buf[state.offset + 1] << 8);

  return { clientStrokeId, serverStrokeId, inkBalance };
}

export function encodeServerStrokeReject(clientStrokeId: number, errorCode: number): Uint8Array {
  const out = new Uint8Array(1 + 4 + 1);
  out[0] = WsMessageType.STROKE_REJECT;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(1, clientStrokeId, true);
  out[5] = errorCode & 0xff;
  return out;
}

export function decodeServerStrokeReject(buf: Uint8Array): ServerStrokeReject {
  if (buf.length < 6 || buf[0] !== WsMessageType.STROKE_REJECT) {
    throw new Error('Invalid STROKE_REJECT message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const clientStrokeId = view.getUint32(1, true);
  const errorCode = buf[5];
  return { clientStrokeId, errorCode };
}

export function encodeServerStrokesHidden(tileX: number, tileY: number, strokeIds: number[]): Uint8Array {
  const out: number[] = [WsMessageType.STROKES_HIDDEN];
  const view = new DataView(new ArrayBuffer(8));
  view.setInt32(0, tileX, true);
  view.setInt32(4, tileY, true);
  for (let i = 0; i < 8; i++) out.push(view.getUint8(i));

  encodeVarint(strokeIds.length, out);
  for (const id of strokeIds) {
    encodeVarint(id, out);
  }
  return new Uint8Array(out);
}

export function decodeServerStrokesHidden(buf: Uint8Array): ServerStrokesHidden {
  if (buf.length < 9 || buf[0] !== WsMessageType.STROKES_HIDDEN) {
    throw new Error('Invalid STROKES_HIDDEN message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tileX = view.getInt32(1, true);
  const tileY = view.getInt32(5, true);

  const state = { offset: 9 };
  const count = decodeVarint(buf, state);
  const strokeIds: number[] = [];
  for (let i = 0; i < count; i++) {
    strokeIds.push(decodeVarint(buf, state));
  }
  return { tileX, tileY, strokeIds };
}

// Live preview binary encoding/decoding

export function encodeClientStrokeBegin(clientStrokeId: number, tileX: number, tileY: number, colorIndex: number, widthIndex: number): Uint8Array {
  const out = new Uint8Array(1 + 4 + 8 + 1 + 1);
  out[0] = WsMessageType.STROKE_BEGIN;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(1, clientStrokeId, true);
  view.setInt32(5, tileX, true);
  view.setInt32(9, tileY, true);
  out[13] = colorIndex & 0x0f;
  out[14] = widthIndex & 0x07;
  return out;
}

export function decodeClientStrokeBegin(buf: Uint8Array): ClientStrokeBegin {
  if (buf.length < 15 || buf[0] !== WsMessageType.STROKE_BEGIN) {
    throw new Error('Invalid STROKE_BEGIN message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const clientStrokeId = view.getUint32(1, true);
  const tileX = view.getInt32(5, true);
  const tileY = view.getInt32(9, true);
  const colorIndex = buf[13];
  const widthIndex = buf[14];
  return { clientStrokeId, tileX, tileY, colorIndex, widthIndex };
}

export function encodeClientStrokePreview(clientStrokeId: number, points: LocalPoint[]): Uint8Array {
  const out: number[] = [WsMessageType.STROKE_PREVIEW];
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, clientStrokeId, true);
  for (let i = 0; i < 4; i++) out.push(view.getUint8(i));

  encodeVarint(points.length, out);
  if (points.length > 0) {
    // First point u16 x, u16 y
    out.push(points[0].x & 0xff, (points[0].x >> 8) & 0xff);
    out.push(points[0].y & 0xff, (points[0].y >> 8) & 0xff);

    let prevX = points[0].x;
    let prevY = points[0].y;
    for (let i = 1; i < points.length; i++) {
      encodeVarint(encodeZigZag(points[i].x - prevX), out);
      encodeVarint(encodeZigZag(points[i].y - prevY), out);
      prevX = points[i].x;
      prevY = points[i].y;
    }
  }
  return new Uint8Array(out);
}

export function decodeClientStrokePreview(buf: Uint8Array): ClientStrokePreview {
  if (buf.length < 5 || buf[0] !== WsMessageType.STROKE_PREVIEW) {
    throw new Error('Invalid STROKE_PREVIEW message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const clientStrokeId = view.getUint32(1, true);
  const state = { offset: 5 };
  const count = decodeVarint(buf, state);
  const points: LocalPoint[] = [];

  if (count > 0) {
    const x0 = buf[state.offset++] | (buf[state.offset++] << 8);
    const y0 = buf[state.offset++] | (buf[state.offset++] << 8);
    points.push({ x: x0, y: y0 });

    let curX = x0;
    let curY = y0;
    for (let i = 1; i < count; i++) {
      const dx = decodeZigZag(decodeVarint(buf, state));
      const dy = decodeZigZag(decodeVarint(buf, state));
      curX += dx;
      curY += dy;
      points.push({ x: curX, y: curY });
    }
  }

  return { clientStrokeId, points };
}

export function encodeServerLiveBegin(tileX: number, tileY: number, liveId: number, colorIndex: number, widthIndex: number): Uint8Array {
  const out = new Uint8Array(1 + 8 + 4 + 1 + 1);
  out[0] = WsMessageType.LIVE_BEGIN;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setInt32(1, tileX, true);
  view.setInt32(5, tileY, true);
  view.setUint32(9, liveId, true);
  out[13] = colorIndex & 0x0f;
  out[14] = widthIndex & 0x07;
  return out;
}

export function decodeServerLiveBegin(buf: Uint8Array): ServerLiveBegin {
  if (buf.length < 15 || buf[0] !== WsMessageType.LIVE_BEGIN) {
    throw new Error('Invalid LIVE_BEGIN message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tileX = view.getInt32(1, true);
  const tileY = view.getInt32(5, true);
  const liveId = view.getUint32(9, true);
  const colorIndex = buf[13];
  const widthIndex = buf[14];
  return { tileX, tileY, liveId, colorIndex, widthIndex };
}

export function encodeServerLivePoints(liveId: number, points: LocalPoint[]): Uint8Array {
  const out: number[] = [WsMessageType.LIVE_POINTS];
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, liveId, true);
  for (let i = 0; i < 4; i++) out.push(view.getUint8(i));

  encodeVarint(points.length, out);
  if (points.length > 0) {
    out.push(points[0].x & 0xff, (points[0].x >> 8) & 0xff);
    out.push(points[0].y & 0xff, (points[0].y >> 8) & 0xff);
    let prevX = points[0].x;
    let prevY = points[0].y;
    for (let i = 1; i < points.length; i++) {
      encodeVarint(encodeZigZag(points[i].x - prevX), out);
      encodeVarint(encodeZigZag(points[i].y - prevY), out);
      prevX = points[i].x;
      prevY = points[i].y;
    }
  }
  return new Uint8Array(out);
}

export function decodeServerLivePoints(buf: Uint8Array): ServerLivePoints {
  if (buf.length < 5 || buf[0] !== WsMessageType.LIVE_POINTS) {
    throw new Error('Invalid LIVE_POINTS message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const liveId = view.getUint32(1, true);
  const state = { offset: 5 };
  const count = decodeVarint(buf, state);
  const points: LocalPoint[] = [];

  if (count > 0) {
    const x0 = buf[state.offset++] | (buf[state.offset++] << 8);
    const y0 = buf[state.offset++] | (buf[state.offset++] << 8);
    points.push({ x: x0, y: y0 });
    let curX = x0;
    let curY = y0;
    for (let i = 1; i < count; i++) {
      const dx = decodeZigZag(decodeVarint(buf, state));
      const dy = decodeZigZag(decodeVarint(buf, state));
      curX += dx;
      curY += dy;
      points.push({ x: curX, y: curY });
    }
  }
  return { liveId, points };
}

export function encodeServerLiveEnd(liveId: number, serverStrokeId = 0): Uint8Array {
  const out: number[] = [WsMessageType.LIVE_END];
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, liveId, true);
  for (let i = 0; i < 4; i++) out.push(view.getUint8(i));
  encodeVarint(serverStrokeId, out);
  return new Uint8Array(out);
}

export function decodeServerLiveEnd(buf: Uint8Array): ServerLiveEnd {
  if (buf.length < 5 || buf[0] !== WsMessageType.LIVE_END) {
    throw new Error('Invalid LIVE_END message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const liveId = view.getUint32(1, true);
  const state = { offset: 5 };
  const serverStrokeId = decodeVarint(buf, state);
  return { liveId, serverStrokeId };
}

// Error Codes are defined in constants.ts

// UNDO (0x08)
export interface ClientUndo {
  serverStrokeId: number;
}

export function encodeClientUndo(serverStrokeId = 0): Uint8Array {
  const out = [WsMessageType.UNDO];
  encodeVarint(serverStrokeId, out);
  return new Uint8Array(out);
}

export function decodeClientUndo(buf: Uint8Array): ClientUndo {
  if (buf.length < 1 || buf[0] !== WsMessageType.UNDO) {
    throw new Error('Invalid UNDO message');
  }
  const state = { offset: 1 };
  const serverStrokeId = state.offset < buf.length ? decodeVarint(buf, state) : 0;
  return { serverStrokeId };
}

// TILE_FROZEN (0x89)
export interface ServerTileFrozen {
  tileX: number;
  tileY: number;
}

export function encodeServerTileFrozen(tileX: number, tileY: number): Uint8Array {
  const out = new Uint8Array(1 + 8);
  out[0] = WsMessageType.TILE_FROZEN;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setInt32(1, tileX, true);
  view.setInt32(5, tileY, true);
  return out;
}

export function decodeServerTileFrozen(buf: Uint8Array): ServerTileFrozen {
  if (buf.length < 9 || buf[0] !== WsMessageType.TILE_FROZEN) {
    throw new Error('Invalid TILE_FROZEN message');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    tileX: view.getInt32(1, true),
    tileY: view.getInt32(5, true),
  };
}

// INK (0x8A)
export interface ServerInk {
  currentInk: number;
  refillIntervalMs: number;
}

export function encodeServerInk(currentInk: number, refillIntervalMs = 2000): Uint8Array {
  const out = [WsMessageType.INK];
  encodeVarint(currentInk, out);
  encodeVarint(refillIntervalMs, out);
  return new Uint8Array(out);
}

export function decodeServerInk(buf: Uint8Array): ServerInk {
  if (buf.length < 2 || buf[0] !== WsMessageType.INK) {
    throw new Error('Invalid INK message');
  }
  const state = { offset: 1 };
  const currentInk = decodeVarint(buf, state);
  const refillIntervalMs = decodeVarint(buf, state);
  return { currentInk, refillIntervalMs };
}

