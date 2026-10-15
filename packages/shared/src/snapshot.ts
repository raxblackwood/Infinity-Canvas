import { decodeVarint, encodeVarint } from './codec.js';

export interface SnapshotStrokeItem {
  id: number;
  data: Uint8Array;
}

export interface TileSnapshot {
  tileX: number;
  tileY: number;
  version: number;
  maxStrokeId: number;
  strokeCount: number;
  strokes: SnapshotStrokeItem[];
}

export const SNAPSHOT_MAGIC = new Uint8Array([0x49, 0x43, 0x54, 0x31]); // 'ICT1'

/**
 * Encodes a tile snapshot into the binary ICT1 format:
 * magic ICT1, i32 tx, i32 ty, u32 version, varint maxStrokeId, varint strokeCount
 * repeated: varint strokeId, varint byteLength, stroke bytes (ascending id)
 */
export function encodeTileSnapshot(snapshot: TileSnapshot): Uint8Array {
  // Ensure strokes are sorted ascending by stroke id
  const sortedStrokes = [...snapshot.strokes].sort((a, b) => a.id - b.id);
  const strokeCount = sortedStrokes.length;
  const maxStrokeId = strokeCount > 0 ? sortedStrokes[sortedStrokes.length - 1].id : 0;

  const headerBytes: number[] = [];
  // magic (4 bytes)
  headerBytes.push(0x49, 0x43, 0x54, 0x31);

  // i32 tx, i32 ty, u32 version (little endian)
  const dv = new DataView(new ArrayBuffer(12));
  dv.setInt32(0, snapshot.tileX, true);
  dv.setInt32(4, snapshot.tileY, true);
  dv.setUint32(8, snapshot.version, true);
  for (let i = 0; i < 12; i++) {
    headerBytes.push(dv.getUint8(i));
  }

  // varint maxStrokeId, varint strokeCount
  encodeVarint(maxStrokeId, headerBytes);
  encodeVarint(strokeCount, headerBytes);

  // Pre-calculate total size to allocate a single buffer
  let totalSize = headerBytes.length;
  const strokeHeaders: { idBytes: number[]; lenBytes: number[]; data: Uint8Array }[] = [];

  for (const item of sortedStrokes) {
    const idBytes = encodeVarint(item.id);
    const lenBytes = encodeVarint(item.data.length);
    totalSize += idBytes.length + lenBytes.length + item.data.length;
    strokeHeaders.push({ idBytes, lenBytes, data: item.data });
  }

  const output = new Uint8Array(totalSize);
  output.set(headerBytes, 0);
  let offset = headerBytes.length;

  for (const item of strokeHeaders) {
    output.set(item.idBytes, offset);
    offset += item.idBytes.length;
    output.set(item.lenBytes, offset);
    offset += item.lenBytes.length;
    output.set(item.data, offset);
    offset += item.data.length;
  }

  return output;
}

/**
 * Decodes a binary ICT1 snapshot into a TileSnapshot object.
 */
export function decodeTileSnapshot(buffer: Uint8Array): TileSnapshot {
  if (buffer.length < 16) {
    throw new Error(`Buffer too short for ICT1 snapshot (${buffer.length} bytes)`);
  }

  // Validate magic ICT1
  if (
    buffer[0] !== 0x49 ||
    buffer[1] !== 0x43 ||
    buffer[2] !== 0x54 ||
    buffer[3] !== 0x31
  ) {
    throw new Error('Invalid snapshot magic, expected ICT1');
  }

  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tileX = dv.getInt32(4, true);
  const tileY = dv.getInt32(8, true);
  const version = dv.getUint32(12, true);

  const state = { offset: 16 };
  const maxStrokeId = decodeVarint(buffer, state);
  const strokeCount = decodeVarint(buffer, state);

  const strokes: SnapshotStrokeItem[] = [];
  let prevId = -1;

  for (let i = 0; i < strokeCount; i++) {
    const strokeId = decodeVarint(buffer, state);
    const byteLength = decodeVarint(buffer, state);

    if (state.offset + byteLength > buffer.length) {
      throw new Error(`Unexpected EOF reading stroke data at index ${i}`);
    }

    const data = buffer.slice(state.offset, state.offset + byteLength);
    state.offset += byteLength;

    if (strokeId <= prevId && i > 0) {
      throw new Error(`Non-ascending stroke id detected: ${strokeId} <= ${prevId}`);
    }
    prevId = strokeId;

    strokes.push({ id: strokeId, data });
  }

  return {
    tileX,
    tileY,
    version,
    maxStrokeId,
    strokeCount,
    strokes,
  };
}
