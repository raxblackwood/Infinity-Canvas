import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, ServerInstance } from '../src/index.js';
import { InMemoryStorage } from '../src/db/storage.js';
import { encodeStroke } from '@infinite-canvas/shared';

describe('Phase 5 Discovery, Activity, and Rules Acceptance', () => {
  let serverInst: ServerInstance;
  let storage: InMemoryStorage;
  let serverUrl: string;

  beforeAll(async () => {
    storage = new InMemoryStorage();
    // Use ephemeral port 0
    serverInst = await createServer(0, storage);
    const address = (serverInst.app.server.address() as any);
    const port = address.port;
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await serverInst.close();
  });

  it('GET /api/spawn returns origin (0, 0) on empty canvas', async () => {
    const res = await fetch(`${serverUrl}/api/spawn`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      tileX: 0,
      tileY: 0,
      offsetX: 0.5,
      offsetY: 0.5,
      scale: 2048,
    });
  });

  it('GET /api/activity returns empty list on empty canvas', async () => {
    const res = await fetch(`${serverUrl}/api/activity`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  it('GET /api/spawn lands near activity after strokes are drawn', async () => {
    // Simulate user drawing strokes on tile (10, -5)
    const strokeData = encodeStroke(0, 2, [
      { x: 1000, y: 1000 },
      { x: 2000, y: 2000 },
    ]);
    await storage.saveStroke(10, -5, 'user-1', strokeData);
    await storage.saveStroke(10, -5, 'user-2', strokeData);
    await storage.saveStroke(3, 7, 'user-3', strokeData);

    const spawnRes = await fetch(`${serverUrl}/api/spawn`);
    expect(spawnRes.status).toBe(200);
    const spawnData = await spawnRes.json();
    // Most active tile is (10, -5) with 2 strokes
    expect(spawnData.tileX).toBe(10);
    expect(spawnData.tileY).toBe(-5);
    expect(spawnData.scale).toBe(2048);

    const actRes = await fetch(`${serverUrl}/api/activity`);
    expect(actRes.status).toBe(200);
    const actData = await actRes.json();
    expect(actData.length).toBe(2);
    expect(actData[0]).toEqual({
      tileX: 10,
      tileY: -5,
      strokeCount: 2,
      activeUsers: 2,
    });
    expect(actData[1]).toEqual({
      tileX: 3,
      tileY: 7,
      strokeCount: 1,
      activeUsers: 1,
    });
  });

  it('POST /api/rules/accept persists acceptance', async () => {
    // 1. Create session
    const sessRes = await fetch(`${serverUrl}/api/session`, { method: 'POST' });
    const sessData = await sessRes.json();
    expect(sessData.rulesVersion).toBe(0);

    // 2. Accept rules
    const acceptRes = await fetch(`${serverUrl}/api/rules/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessData.token}`,
      },
      body: JSON.stringify({ rulesVersion: 1 }),
    });
    expect(acceptRes.status).toBe(200);
    const acceptData = await acceptRes.json();
    expect(acceptData.accepted).toBe(true);
    expect(acceptData.rulesVersion).toBe(1);

    // 3. Verify user in storage has rulesVersion = 1
    const resumed = await serverInst.sessionManager.resumeSession(sessData.token);
    expect(resumed?.user.rulesVersion).toBe(1);
  });
});
