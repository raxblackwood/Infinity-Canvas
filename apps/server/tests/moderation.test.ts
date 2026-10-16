import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, ServerInstance } from '../src/index.js';
import { InMemoryStorage } from '../src/db/storage.js';
import { MockModerationProvider } from '../src/moderation/index.js';
import WebSocket from 'ws';
import {
  encodeClientHello,
  encodeClientSubscribe,
  encodeClientStrokeCommit,
  encodeStroke,
  decodeServerWelcome,
  decodeServerStrokesHidden,
  WsMessageType,
} from '@infinite-canvas/shared';

describe('Phase 4: Moderation & Admin Tooling', () => {
  let server: ServerInstance;
  let storage: InMemoryStorage;
  let mockModProvider: MockModerationProvider;
  let port: number;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    mockModProvider = new MockModerationProvider();
    server = await createServer(0, storage, mockModProvider);
    port = server.port;
  });

  afterEach(async () => {
    await server.close();
  });

  const connectClient = async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const sessionRes = await fetch(`http://localhost:${port}/api/session`, { method: 'POST' });
    const { token } = await sessionRes.json();

    ws.send(encodeClientHello(token, 'test-client', 0));

    // Wait for WELCOME
    await new Promise<void>((resolve) => {
      ws.once('message', (data: Buffer) => {
        const msg = decodeServerWelcome(new Uint8Array(data));
        expect(msg.userId).toBeDefined();
        resolve();
      });
    });

    return { ws, token };
  };

  it('Automated scan flags tile, quarantines strokes, broadcasts STROKES_HIDDEN, and enqueues review item', async () => {
    const { ws } = await connectClient();

    // Subscribe to tile (4, 4)
    ws.send(encodeClientSubscribe([{ tileX: 4, tileY: 4, sinceStrokeId: 0, live: true }]));
    await new Promise((r) => setTimeout(r, 50));

    // Draw and commit a stroke on tile (4, 4)
    const strokeData = encodeStroke(0, 1, [
      { x: 100, y: 100, p: 0.5 },
      { x: 150, y: 150, p: 0.5 },
    ]);
    ws.send(encodeClientStrokeCommit(1, 4, 4, strokeData));
    await new Promise((r) => setTimeout(r, 100));

    // Check stroke is saved with status = 0 (visible)
    const visibleBefore = await storage.getVisibleStrokesForTile(4, 4);
    expect(visibleBefore.length).toBe(1);
    const strokeId = visibleBefore[0].id;

    // Listen for WebSocket STROKES_HIDDEN (0x88)
    const hiddenPromise = new Promise<{ tileX: number; tileY: number; strokeIds: number[] }>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const u8 = new Uint8Array(data);
        if (u8[0] === WsMessageType.STROKES_HIDDEN) {
          resolve(decodeServerStrokesHidden(u8));
        }
      });
    });

    // Configure mock provider to flag tile (4, 4)
    mockModProvider.setTileFlagged(4, 4, true);

    // Trigger scan on tile (4, 4)
    const scanResult = await server.moderationService.scanTile(4, 4, Buffer.alloc(10));
    expect(scanResult.flagged).toBe(true);

    // Verify STROKES_HIDDEN received over WebSocket
    const hiddenMsg = await hiddenPromise;
    expect(hiddenMsg.tileX).toBe(4);
    expect(hiddenMsg.tileY).toBe(4);
    expect(hiddenMsg.strokeIds).toContain(strokeId);

    // Verify stroke is quarantined (status = 2) so getVisibleStrokesForTile returns 0
    const visibleAfter = await storage.getVisibleStrokesForTile(4, 4);
    expect(visibleAfter.length).toBe(0);

    // Verify review item was created
    const queue = await storage.getReviewQueue(0);
    expect(queue.length).toBe(1);
    expect(queue[0].tileX).toBe(4);
    expect(queue[0].tileY).toBe(4);
    expect(queue[0].priority).toBe(5);

    ws.close();
  });

  it('Report flow: auto-quarantines on 3+ distinct user reports within 1 hour', async () => {
    const { ws, token } = await connectClient();

    // Subscribe to tile (10, 10)
    ws.send(encodeClientSubscribe([{ tileX: 10, tileY: 10, sinceStrokeId: 0, live: true }]));
    await new Promise((r) => setTimeout(r, 50));

    // Commit a stroke on tile (10, 10)
    const strokeData = encodeStroke(2, 2, [
      { x: 500, y: 500, p: 0.5 },
      { x: 600, y: 600, p: 0.5 },
    ]);
    ws.send(encodeClientStrokeCommit(1, 10, 10, strokeData));
    await new Promise((r) => setTimeout(r, 100));

    // User 1 reports
    const rep1 = await fetch(`http://localhost:${port}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tileX: 10, tileY: 10, reason: 'inappropriate_content' }),
    });
    const res1 = await rep1.json();
    expect(res1.success).toBe(true);
    expect(res1.autoQuarantined).toBe(false);

    // User 2 reports
    const rep2 = await fetch(`http://localhost:${port}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tileX: 10, tileY: 10, reason: 'hate_speech' }),
    });
    const res2 = await rep2.json();
    expect(res2.success).toBe(true);
    expect(res2.autoQuarantined).toBe(false);

    // Set up STROKES_HIDDEN listener for User 3 report
    const hiddenPromise = new Promise<{ tileX: number; tileY: number; strokeIds: number[] }>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const u8 = new Uint8Array(data);
        if (u8[0] === WsMessageType.STROKES_HIDDEN) {
          resolve(decodeServerStrokesHidden(u8));
        }
      });
    });

    // User 3 reports (triggers auto-quarantine)
    const rep3 = await fetch(`http://localhost:${port}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tileX: 10, tileY: 10, reason: 'vandalism' }),
    });
    const res3 = await rep3.json();
    expect(res3.success).toBe(true);
    expect(res3.autoQuarantined).toBe(true);

    const hiddenMsg = await hiddenPromise;
    expect(hiddenMsg.tileX).toBe(10);
    expect(hiddenMsg.tileY).toBe(10);
    expect(hiddenMsg.strokeIds.length).toBeGreaterThan(0);

    // Stroke is now quarantined
    const visible = await storage.getVisibleStrokesForTile(10, 10);
    expect(visible.length).toBe(0);

    // Urgent review item is in queue
    const queue = await storage.getReviewQueue(0);
    expect(queue.some((q) => q.priority === 10)).toBe(true);

    ws.close();
  });

  it('Admin API: requires valid token, provides review queue, actions, bulk hide, bans, and audit log', async () => {
    const adminToken = process.env.ADMIN_TOKEN || 'admin-secret-token';
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // 1. Unauthorized request rejected
    const unauthRes = await fetch(`http://localhost:${port}/admin/api/review-queue`);
    expect(unauthRes.status).toBe(401);

    // 2. Authorized review queue fetch
    await storage.enqueueReviewItem(12, 12, 'Test automated flag', 5, 5);
    const queueRes = await fetch(`http://localhost:${port}/admin/api/review-queue`, { headers: authHeaders });
    expect(queueRes.status).toBe(200);
    const queueData = await queueRes.json();
    expect(queueData.items.length).toBe(1);
    const itemId = queueData.items[0].id;

    // 3. Action review item (restore)
    const actionRes = await fetch(`http://localhost:${port}/admin/api/review/${itemId}/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ action: 'restore', reason: 'False positive flag' }),
    });
    expect(actionRes.status).toBe(200);

    // Review item resolved
    const pendingQueue = await storage.getReviewQueue(0);
    expect(pendingQueue.length).toBe(0);

    // 4. Bulk hide region
    const bulkRes = await fetch(`http://localhost:${port}/admin/api/bulk-action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ minTx: 0, minTy: 0, maxTx: 5, maxTy: 5, reason: 'Griefing cleanup' }),
    });
    expect(bulkRes.status).toBe(200);

    // 5. User ban
    const banRes = await fetch(`http://localhost:${port}/admin/api/users/test-bad-user/ban`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ banned: true, reason: 'TOS violation' }),
    });
    expect(banRes.status).toBe(200);

    // 6. Audit log verifies all mod actions were recorded
    const actionsRes = await fetch(`http://localhost:${port}/admin/api/actions`, { headers: authHeaders });
    expect(actionsRes.status).toBe(200);
    const actionsData = await actionsRes.json();
    const actionTypes = actionsData.actions.map((a: any) => a.action);
    expect(actionTypes).toContain('bulk_hide');
    expect(actionTypes).toContain('ban_user');

    // 7. Stats counter
    const statsRes = await fetch(`http://localhost:${port}/admin/api/stats`, { headers: authHeaders });
    expect(statsRes.status).toBe(200);
    const statsData = await statsRes.json();
    expect(statsData.stats).toHaveProperty('strokesPerMinute');
    expect(statsData.stats).toHaveProperty('activeUsers');
    expect(statsData.stats).toHaveProperty('openReports');
    expect(statsData.stats).toHaveProperty('reviewQueueDepth');
  });

  it('supports reporting multiple tiles at once and triggers quarantine across all reported tiles', async () => {
    const { ws, token } = await connectClient();

    // Subscribe to tiles (20, 20) and (20, 21)
    ws.send(
      encodeClientSubscribe([
        { tileX: 20, tileY: 20, sinceStrokeId: 0, live: true },
        { tileX: 20, tileY: 21, sinceStrokeId: 0, live: true },
      ])
    );
    await new Promise((r) => setTimeout(r, 50));

    // Draw strokes on both tiles
    const s1 = encodeStroke(1, 1, [
      { x: 100, y: 100, p: 0.5 },
      { x: 200, y: 200, p: 0.5 },
    ]);
    const s2 = encodeStroke(1, 1, [
      { x: 300, y: 300, p: 0.5 },
      { x: 400, y: 400, p: 0.5 },
    ]);
    ws.send(encodeClientStrokeCommit(1, 20, 20, s1));
    ws.send(encodeClientStrokeCommit(2, 20, 21, s2));
    await new Promise((r) => setTimeout(r, 100));

    // Multi-tile report with array of tiles
    const res1 = await fetch(`http://localhost:${port}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tiles: [
          { tileX: 20, tileY: 20 },
          { tileX: 20, tileY: 21 },
        ],
        reason: 'vandalism',
        note: 'Graffiti across tiles',
      }),
    });
    const data1 = await res1.json();
    expect(data1.success).toBe(true);
    expect(data1.count).toBe(2);
    expect(data1.reportIds.length).toBe(2);

    // Multi-tile report with bounding box (minTx, minTy to maxTx, maxTy)
    const res2 = await fetch(`http://localhost:${port}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minTx: 20,
        minTy: 20,
        maxTx: 20,
        maxTy: 21,
        reason: 'hate_speech',
      }),
    });
    const data2 = await res2.json();
    expect(data2.success).toBe(true);
    expect(data2.count).toBe(2);

    // 3rd report triggers auto-quarantine for both tiles
    const res3 = await fetch(`http://localhost:${port}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tiles: [
          { tileX: 20, tileY: 20 },
          { tileX: 20, tileY: 21 },
        ],
        reason: 'inappropriate_content',
      }),
    });
    const data3 = await res3.json();
    expect(data3.success).toBe(true);
    expect(data3.autoQuarantined).toBe(true);
    expect(data3.quarantinedTiles.length).toBe(2);

    // Verify both tiles have strokes quarantined
    const visible1 = await storage.getVisibleStrokesForTile(20, 20);
    const visible2 = await storage.getVisibleStrokesForTile(20, 21);
    expect(visible1.length).toBe(0);
    expect(visible2.length).toBe(0);

    ws.close();
  });
});
