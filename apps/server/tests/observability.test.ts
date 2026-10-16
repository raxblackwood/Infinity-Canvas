import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, ServerInstance } from '../src/index.js';
import { InMemoryStorage } from '../src/db/storage.js';

describe('Phase 6 Observability, Health & Metrics', () => {
  let serverInst: ServerInstance;
  let serverUrl: string;

  beforeAll(async () => {
    const storage = new InMemoryStorage();
    serverInst = await createServer(0, storage);
    const address = (serverInst.app.server.address() as any);
    serverUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    await serverInst.close();
  });

  it('GET /healthz returns 200 ok with uptime and timestamp', async () => {
    const res = await fetch(`${serverUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.timestamp).toBe('number');
  });

  it('GET /readyz returns 200 ready when storage is reachable', async () => {
    const res = await fetch(`${serverUrl}/readyz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.storage).toBe('ok');
    expect(body.stats).toBeDefined();
  });

  it('GET /metrics returns Prometheus-formatted text metrics', async () => {
    const res = await fetch(`${serverUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const text = await res.text();
    expect(text).toContain('canvas_open_connections');
    expect(text).toContain('canvas_strokes_total');
    expect(text).toContain('canvas_bytes_out_total');
    expect(text).toContain('canvas_ack_latency_ms');
    expect(text).toContain('canvas_process_resident_memory_bytes');
  });
});
