import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import {
  encodeClientHello,
  decodeServerWelcome,
  encodeClientSubscribe,
  decodeServerTileDelta,
  encodeClientStrokeCommit,
  encodeStroke,
  decodeServerStrokeAck,
  WsMessageType,
} from '@infinite-canvas/shared';
import { createServer, ServerInstance } from '../src/index.js';
import { InMemoryStorage } from '../src/db/storage.js';

describe('Phase 1 Realtime Server & WebSocket Gateway', () => {
  let serverInst: ServerInstance;
  let sharedStorage: InMemoryStorage;
  const PORT = 3456;

  beforeAll(async () => {
    sharedStorage = new InMemoryStorage();
    serverInst = await createServer(PORT, sharedStorage);
  });

  afterAll(async () => {
    await serverInst.close();
  });

  it('authenticates client with HELLO and receives WELCOME', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

    const welcomePromise = new Promise<any>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.WELCOME) {
          resolve(decodeServerWelcome(buf));
        }
      });
    });

    await new Promise((r) => ws.on('open', r));

    // Send HELLO with 32-byte token
    const token = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
    ws.send(encodeClientHello(token, 1));

    const welcome = await welcomePromise;
    expect(welcome.userId).toBeDefined();
    expect(welcome.inkBurst).toBe(100);
    expect(welcome.readOnly).toBe(false);

    ws.close();
  });

  it('two clients see each other draw live within 500 ms p95', async () => {
    const ws1 = new WebSocket(`ws://localhost:${PORT}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${PORT}/ws`);

    await Promise.all([
      new Promise((r) => ws1.on('open', r)),
      new Promise((r) => ws2.on('open', r)),
    ]);

    // Authenticate both
    const token1 = 'aa'.repeat(32);
    const token2 = 'bb'.repeat(32);
    ws1.send(encodeClientHello(token1, 1));
    ws2.send(encodeClientHello(token2, 1));

    // Wait for welcomes
    await new Promise((r) => setTimeout(r, 50));

    // Subscribe both to tile (5, 5)
    ws1.send(encodeClientSubscribe([{ tileX: 5, tileY: 5, sinceStrokeId: 0, live: true }]));
    ws2.send(encodeClientSubscribe([{ tileX: 5, tileY: 5, sinceStrokeId: 0, live: true }]));

    await new Promise((r) => setTimeout(r, 50));

    // Client 2 listens for TILE_DELTA
    const deltaReceivedPromise = new Promise<{ latencyMs: number; delta: any }>((resolve) => {
      const sendTime = performance.now();
      ws2.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.TILE_DELTA) {
          const delta = decodeServerTileDelta(buf);
          const latencyMs = performance.now() - sendTime;
          resolve({ latencyMs, delta });
        }
      });
    });

    // Client 1 commits a stroke on tile (5, 5)
    const points = [
      { x: 1000, y: 1000 },
      { x: 2000, y: 2000 },
    ];
    const strokeBytes = encodeStroke(3, 2, points);
    const commitBuf = encodeClientStrokeCommit(101, 5, 5, strokeBytes);

    ws1.send(commitBuf);

    const result = await deltaReceivedPromise;
    expect(result.latencyMs).toBeLessThan(500); // Latency target: < 500 ms p95
    expect(result.delta.tileX).toBe(5);
    expect(result.delta.tileY).toBe(5);
    expect(result.delta.strokes).toHaveLength(1);
    expect(result.delta.strokes[0].strokeBytes).toEqual(strokeBytes);

    ws1.close();
    ws2.close();
  });

  it('strokes survive a server restart and client catches up on reconnect', async () => {
    // 1. Commit stroke #999 to tile (10, 10)
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => ws.on('open', r));
    ws.send(encodeClientHello('cc'.repeat(32), 1));
    await new Promise((r) => setTimeout(r, 50));

    const strokeBytes = encodeStroke(0, 1, [{ x: 5000, y: 5000 }]);
    ws.send(encodeClientStrokeCommit(202, 10, 10, strokeBytes));

    // Wait for ACK
    await new Promise<void>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.STROKE_ACK) resolve();
      });
    });
    ws.close();

    // 2. Restart server with same persistent storage
    await serverInst.close();
    serverInst = await createServer(PORT, sharedStorage);

    // 3. Reconnect new client, subscribe with sinceStrokeId = 0
    const wsReconnect = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => wsReconnect.on('open', r));
    wsReconnect.send(encodeClientHello('dd'.repeat(32), 1));
    await new Promise((r) => setTimeout(r, 50));

    const deltaOnReconnect = new Promise<any>((resolve) => {
      wsReconnect.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.TILE_DELTA) {
          resolve(decodeServerTileDelta(buf));
        }
      });
    });

    wsReconnect.send(encodeClientSubscribe([{ tileX: 10, tileY: 10, sinceStrokeId: 0, live: true }]));

    const recoveredDelta = await deltaOnReconnect;
    expect(recoveredDelta.tileX).toBe(10);
    expect(recoveredDelta.tileY).toBe(10);
    expect(recoveredDelta.strokes.length).toBeGreaterThanOrEqual(1);
    expect(recoveredDelta.strokes[0].strokeBytes).toEqual(strokeBytes);

    wsReconnect.close();
  });

  it('serves POST /api/tile-index and GET /snapshot/* correctly', async () => {
    // 1. Setup a snapshot in storage and object store
    await sharedStorage.updateTileSnapshot(1, 2, 3, 'snapshots/1_2_v3.ict1', 50);
    const fakeSnapshotBytes = new Uint8Array([0x49, 0x43, 0x54, 0x31, 0, 0, 0, 0]);
    await serverInst.objectStore.put('snapshots/1_2_v3.ict1', fakeSnapshotBytes, 'application/octet-stream');

    // 2. Query /api/tile-index
    const res = await fetch(`http://localhost:${PORT}/api/tile-index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ tileX: 1, tileY: 2 }, { tileX: 99, tileY: 99 }]),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(2);

    expect(data[0].tileX).toBe(1);
    expect(data[0].tileY).toBe(2);
    expect(data[0].snapshotVersion).toBe(3);
    expect(data[0].snapshotUrl).toBe('/snapshot/snapshots/1_2_v3.ict1');
    expect(data[0].maxStrokeId).toBe(50);

    // Empty tile (99, 99)
    expect(data[1].tileX).toBe(99);
    expect(data[1].tileY).toBe(99);
    expect(data[1].snapshotVersion).toBe(0);
    expect(data[1].snapshotUrl).toBeNull();

    // 3. Fetch snapshot through GET /snapshot/*
    const snapRes = await fetch(`http://localhost:${PORT}${data[0].snapshotUrl}`);
    expect(snapRes.status).toBe(200);
    expect(snapRes.headers.get('content-type')).toBe('application/octet-stream');
    expect(snapRes.headers.get('cache-control')).toContain('immutable');
    const snapBody = new Uint8Array(await snapRes.arrayBuffer());
    expect(snapBody).toEqual(fakeSnapshotBytes);
  });

  it('serves GET /raster/:level/:x/:y.webp or returns 404 for empty', async () => {
    // 1. Empty raster tile returns 404
    const emptyRes = await fetch(`http://localhost:${PORT}/raster/0/42/42.webp`);
    expect(emptyRes.status).toBe(404);

    // 2. Saved raster tile returns WebP with immutable cache-control
    await sharedStorage.saveRasterTile(0, 5, 5, 1, 'raster/0/5_5_v1.webp');
    const fakeWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF
    await serverInst.objectStore.put('raster/0/5_5_v1.webp', fakeWebp, 'image/webp');

    const validRes = await fetch(`http://localhost:${PORT}/raster/0/5/5.webp?v=1`);
    expect(validRes.status).toBe(200);
    expect(validRes.headers.get('content-type')).toBe('image/webp');
    expect(validRes.headers.get('cache-control')).toContain('immutable');
    const validBody = new Uint8Array(await validRes.arrayBuffer());
    expect(validBody).toEqual(fakeWebp);
  });
});
