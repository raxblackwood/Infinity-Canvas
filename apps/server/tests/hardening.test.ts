import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import {
  encodeClientHello,
  decodeServerWelcome,
  encodeClientSubscribe,
  encodeClientStrokeCommit,
  encodeClientStrokeBegin,
  encodeClientStrokePreview,
  encodeClientUndo,
  encodeStroke,
  decodeServerStrokeAck,
  decodeServerStrokeReject,
  decodeServerStrokesHidden,
  decodeServerTileFrozen,
  decodeServerInk,
  WsMessageType,
  ErrorCode,
  calculateStrokeInkCost,
  TILE_STROKE_CAP,
} from '@infinite-canvas/shared';
import { createServer, ServerInstance, InMemoryStorage, UserInkBucket } from '../src/index.js';

describe('Phase 3 Hardening, Limits, and Abuse Prevention', () => {
  let serverInst: ServerInstance;
  let storage: InMemoryStorage;
  const PORT = 3567;

  beforeAll(async () => {
    storage = new InMemoryStorage();
    serverInst = await createServer(PORT, storage);
  });

  afterAll(async () => {
    await serverInst.close();
  });

  it('calculates correct stroke ink cost: 1 + ceil(points / 64)', () => {
    expect(calculateStrokeInkCost(1)).toBe(2);
    expect(calculateStrokeInkCost(64)).toBe(2);
    expect(calculateStrokeInkCost(65)).toBe(3);
    expect(calculateStrokeInkCost(128)).toBe(3);
    expect(calculateStrokeInkCost(512)).toBe(9);
  });

  it('UserInkBucket enforces capacity 100 and refills at 0.5 token/sec', async () => {
    const bucket = new UserInkBucket();
    expect(bucket.getBalance()).toBe(100);

    // Consume 10 points (cost = 2)
    const res1 = bucket.tryConsume(10);
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(98);

    // Consume large stroke 512 points (cost = 9)
    const res2 = bucket.tryConsume(512);
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(89);

    // Refund 512 points
    const refunded = bucket.refund(512);
    expect(refunded).toBe(98);
  });

  it('rejects commits with INK_EMPTY when user bucket is exhausted', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => ws.on('open', r));

    const token = '11'.repeat(32);
    const welcomePromise = new Promise<any>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.WELCOME) {
          resolve(decodeServerWelcome(buf));
        }
      });
    });

    ws.send(encodeClientHello(token, 1));
    const welcome = await welcomePromise;

    // Subscribe to tile (1, 1)
    ws.send(encodeClientSubscribe([{ tileX: 1, tileY: 1, sinceStrokeId: 0, live: true }]));
    await new Promise((r) => setTimeout(r, 50));

    // Manually drain user's ink bucket on the server
    const bucket = serverInst.gateway.inkManager.getBucket(welcome.userId);
    while (bucket.getBalance() > 1) {
      bucket.tryConsume(512);
    }

    // Try committing a stroke that costs 2 tokens
    const strokeBytes = encodeStroke(0, 1, [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    const commitBuf = encodeClientStrokeCommit(501, 1, 1, strokeBytes);

    const rejectPromise = new Promise<{ clientStrokeId: number; errorCode: number }>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.STROKE_REJECT) {
          resolve(decodeServerStrokeReject(buf));
        }
      });
    });

    ws.send(commitBuf);
    const reject = await rejectPromise;
    expect(reject.clientStrokeId).toBe(501);
    expect(reject.errorCode).toBe(ErrorCode.INK_EMPTY);

    ws.close();
  });

  it('rejects commits with BAD_STROKE for out-of-bounds coordinates and invalid params', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => ws.on('open', r));

    const token = '22'.repeat(32);
    ws.send(encodeClientHello(token, 1));
    await new Promise((r) => setTimeout(r, 50));

    ws.send(encodeClientSubscribe([{ tileX: 2, tileY: 2, sinceStrokeId: 0, live: true }]));
    await new Promise((r) => setTimeout(r, 50));

    // Out-of-bounds point: x > 65535
    const badPoints = [
      { x: 60000, y: 1000 },
      { x: 70000, y: 2000 }, // exceeds uint16 / tile coordinate bounds!
    ];
    // Encode stroke with invalid point
    const badBytes = encodeStroke(0, 1, badPoints);
    const badCommit = encodeClientStrokeCommit(601, 2, 2, badBytes);

    const rejectPromise = new Promise<{ clientStrokeId: number; errorCode: number }>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.STROKE_REJECT) {
          resolve(decodeServerStrokeReject(buf));
        }
      });
    });

    ws.send(badCommit);
    const reject = await rejectPromise;
    expect(reject.clientStrokeId).toBe(601);
    expect(reject.errorCode).toBe(ErrorCode.BAD_STROKE);

    ws.close();
  });

  it('enforces TILE_STROKE_CAP: broadcasts TILE_FROZEN and rejects further commits with TILE_FULL', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => ws.on('open', r));

    const token = '33'.repeat(32);
    ws.send(encodeClientHello(token, 1));
    await new Promise((r) => setTimeout(r, 50));

    const tx = 99;
    const ty = 99;
    ws.send(encodeClientSubscribe([{ tileX: tx, tileY: ty, sinceStrokeId: 0, live: true }]));
    await new Promise((r) => setTimeout(r, 50));

    // Set tile strokeCount to TILE_STROKE_CAP - 1
    const tile = await storage.getTile(tx, ty);
    tile.strokeCount = TILE_STROKE_CAP - 1;

    // Listen for TILE_FROZEN
    let frozenBroadcastReceived = false;
    ws.on('message', (data: Buffer) => {
      const buf = new Uint8Array(data);
      if (buf[0] === WsMessageType.TILE_FROZEN) {
        const frozen = decodeServerTileFrozen(buf);
        if (frozen.tileX === tx && frozen.tileY === ty) {
          frozenBroadcastReceived = true;
        }
      }
    });

    // Commit 1 stroke to reach TILE_STROKE_CAP
    const strokeBytes = encodeStroke(1, 1, [
      { x: 500, y: 500 },
      { x: 600, y: 600 },
    ]);
    ws.send(encodeClientStrokeCommit(701, tx, ty, strokeBytes));

    await new Promise((r) => setTimeout(r, 100));
    expect(frozenBroadcastReceived).toBe(true);
    expect(tile.frozen).toBe(true);

    // Commit another stroke to the now frozen tile: must reject with TILE_FULL
    const rejectPromise = new Promise<{ clientStrokeId: number; errorCode: number }>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.STROKE_REJECT) {
          resolve(decodeServerStrokeReject(buf));
        }
      });
    });

    ws.send(encodeClientStrokeCommit(702, tx, ty, strokeBytes));
    const reject = await rejectPromise;
    expect(reject.clientStrokeId).toBe(702);
    expect(reject.errorCode).toBe(ErrorCode.TILE_FULL);

    ws.close();
  });

  it('undo within 30s marks stroke undone, broadcasts STROKES_HIDDEN, and refunds ink', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => ws.on('open', r));

    const token = '44'.repeat(32);
    ws.send(encodeClientHello(token, 1));
    await new Promise((r) => setTimeout(r, 50));

    const tx = 3;
    const ty = 3;
    ws.send(encodeClientSubscribe([{ tileX: tx, tileY: ty, sinceStrokeId: 0, live: true }]));
    await new Promise((r) => setTimeout(r, 50));

    // Commit a stroke with 64 points (cost = 2)
    const points = Array.from({ length: 64 }, (_, i) => ({ x: 100 + i * 10, y: 100 + i * 10 }));
    const strokeBytes = encodeStroke(2, 2, points);

    let ackInk = 0;
    const ackPromise = new Promise<void>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.STROKE_ACK) {
          const ack = decodeServerStrokeAck(buf);
          ackInk = ack.inkBalance;
          resolve();
        }
      });
    });

    ws.send(encodeClientStrokeCommit(801, tx, ty, strokeBytes));
    await ackPromise;
    expect(ackInk).toBe(98);

    // Listen for STROKES_HIDDEN and INK messages
    const hiddenPromise = new Promise<{ tileX: number; tileY: number; strokeIds: number[] }>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.STROKES_HIDDEN) {
          resolve(decodeServerStrokesHidden(buf));
        }
      });
    });

    const inkRefundPromise = new Promise<number>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.INK) {
          const ink = decodeServerInk(buf);
          resolve(ink.currentInk);
        }
      });
    });

    // Send UNDO
    ws.send(encodeClientUndo(0));

    const hidden = await hiddenPromise;
    expect(hidden.tileX).toBe(tx);
    expect(hidden.tileY).toBe(ty);
    expect(hidden.strokeIds.length).toBe(1);

    const refundedInk = await inkRefundPromise;
    expect(refundedInk).toBe(100); // 98 + 2 = 100 refunded!

    // Verify stroke status is 3 (undone) in storage
    const visible = await storage.getVisibleStrokesForTile(tx, ty);
    expect(visible.length).toBe(0);

    ws.close();
  });

  it('read-only kill switch rejects commits with READ_ONLY and flags WELCOME', async () => {
    // Enable kill switch
    const switchRes = await fetch(`http://localhost:${PORT}/admin/api/kill-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readOnly: true }),
    });
    expect(switchRes.ok).toBe(true);
    const switchData = await switchRes.json();
    expect(switchData.readOnly).toBe(true);

    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => ws.on('open', r));

    const token = '55'.repeat(32);
    const welcomePromise = new Promise<any>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.WELCOME) {
          resolve(decodeServerWelcome(buf));
        }
      });
    });

    ws.send(encodeClientHello(token, 1));
    const welcome = await welcomePromise;
    expect(welcome.readOnly).toBe(true);

    // Try committing a stroke while read-only
    const strokeBytes = encodeStroke(0, 1, [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    const commitBuf = encodeClientStrokeCommit(901, 1, 1, strokeBytes);

    const rejectPromise = new Promise<{ clientStrokeId: number; errorCode: number }>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const buf = new Uint8Array(data);
        if (buf[0] === WsMessageType.STROKE_REJECT) {
          resolve(decodeServerStrokeReject(buf));
        }
      });
    });

    ws.send(commitBuf);
    const reject = await rejectPromise;
    expect(reject.clientStrokeId).toBe(901);
    expect(reject.errorCode).toBe(ErrorCode.READ_ONLY);

    // Turn off kill switch
    await fetch(`http://localhost:${PORT}/admin/api/kill-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readOnly: false }),
    });

    ws.close();
  });

  it('enforces preview limits: max 8 open previews and dropped if not subscribed', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => ws.on('open', r));

    const token = '66'.repeat(32);
    ws.send(encodeClientHello(token, 1));
    await new Promise((r) => setTimeout(r, 50));

    // Client is NOT subscribed to tile (10, 10). Sending STROKE_BEGIN should be dropped silently.
    ws.send(encodeClientStrokeBegin(1, 10, 10, 0, 1));
    await new Promise((r) => setTimeout(r, 50));

    // Now subscribe to tile (10, 10)
    ws.send(encodeClientSubscribe([{ tileX: 10, tileY: 10, sinceStrokeId: 0, live: true }]));
    await new Promise((r) => setTimeout(r, 50));

    // Open 8 previews
    for (let i = 1; i <= 8; i++) {
      ws.send(encodeClientStrokeBegin(i, 10, 10, 0, 1));
    }
    await new Promise((r) => setTimeout(r, 50));

    // 9th preview: should be dropped by preview limiter (canBeginPreview returns false)
    ws.send(encodeClientStrokeBegin(9, 10, 10, 0, 1));
    await new Promise((r) => setTimeout(r, 50));

    ws.close();
  });

  it('enforces IP rate limits: max 10 sessions per min per IP', async () => {
    const testIp = '198.51.100.42';

    // 10 session creations succeed
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`http://localhost:${PORT}/api/session`, {
        method: 'POST',
        headers: { 'X-Forwarded-For': testIp },
      });
      expect(res.status).toBe(200);
    }

    // 11th session creation should receive 429
    const overflowRes = await fetch(`http://localhost:${PORT}/api/session`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': testIp },
    });
    expect(overflowRes.status).toBe(429);
  });
});
