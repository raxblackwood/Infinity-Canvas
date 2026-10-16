import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { WebSocketServer } from 'ws';
import { createStorage, Storage } from './db/storage.js';
import { SessionManager } from './session/sessionManager.js';
import { WebSocketGateway } from './gateway/gateway.js';
import { getObjectStore, ObjectStore } from './storage/objectStore.js';
import { RateLimiter } from './limiter/rateLimiter.js';
import { InkManager } from './limiter/inkLimiter.js';
import { ModerationService, ModerationProvider, MockModerationProvider } from './moderation/index.js';

export {
  createStorage,
  type Storage,
  InMemoryStorage,
  PostgresStorage,
  type UserRecord,
  type TileRecord,
  type StrokeRecord,
  type BakeJobRecord,
  type ReportRecord,
  type ReviewItemRecord,
  type ModActionRecord,
} from './db/storage.js';
export {
  getObjectStore,
  type ObjectStore,
  MemoryObjectStore,
  S3ObjectStore,
} from './storage/objectStore.js';
export { RateLimiter, ConnectionPreviewLimiter } from './limiter/rateLimiter.js';
export { InkManager, UserInkBucket } from './limiter/inkLimiter.js';
export {
  ModerationService,
  type ModerationProvider,
  type ModerationResult,
  MockModerationProvider,
} from './moderation/index.js';

export interface ServerInstance {
  app: FastifyInstance;
  wss: WebSocketServer;
  gateway: WebSocketGateway;
  storage: Storage;
  sessionManager: SessionManager;
  objectStore: ObjectStore;
  moderationService: ModerationService;
  port: number;
  close: () => Promise<void>;
}

export async function createServer(
  customPort?: number,
  customStorage?: Storage,
  customModerationProvider?: ModerationProvider
): Promise<ServerInstance> {
  const storage = customStorage || (await createStorage());
  const sessionManager = new SessionManager(storage);
  const objectStore = getObjectStore();
  const rateLimiter = new RateLimiter();
  rateLimiter.exemptLoopback = process.env.NODE_ENV !== 'production';
  const inkManager = new InkManager();

  let gatewayInstance: WebSocketGateway | null = null;

  const modProvider = customModerationProvider || new MockModerationProvider();
  const moderationService = new ModerationService(
    storage,
    modProvider,
    (tx, ty, strokeIds) => {
      gatewayInstance?.broadcastStrokesHidden(tx, ty, strokeIds);
    }
  );

  const app = fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: '*',
  });

  // Health & Observability (SPEC Section 12)
  app.get('/healthz', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
  }));

  app.get('/readyz', async (req, reply) => {
    try {
      const stats = await storage.getStats();
      return {
        status: 'ready',
        uptime: process.uptime(),
        timestamp: Date.now(),
        storage: 'ok',
        stats,
      };
    } catch (err: any) {
      reply.status(503);
      return {
        status: 'not_ready',
        error: err?.message || 'Storage not reachable',
      };
    }
  });

  app.get('/metrics', async (req, reply) => {
    const m = gatewayInstance
      ? gatewayInstance.getMetrics()
      : {
          openConnections: 0,
          totalStrokesCommitted: 0,
          totalBytesOut: 0,
          p50LatencyMs: 0,
          p95LatencyMs: 0,
          topSubscribedTiles: [],
          rejectsByCode: {},
        };
    const mem = process.memoryUsage();

    let text = `# HELP canvas_open_connections Current active WebSocket connections\n`;
    text += `# TYPE canvas_open_connections gauge\n`;
    text += `canvas_open_connections ${m.openConnections}\n\n`;

    text += `# HELP canvas_strokes_total Total committed strokes\n`;
    text += `# TYPE canvas_strokes_total counter\n`;
    text += `canvas_strokes_total ${m.totalStrokesCommitted}\n\n`;

    text += `# HELP canvas_bytes_out_total Total bytes sent over WebSockets\n`;
    text += `# TYPE canvas_bytes_out_total counter\n`;
    text += `canvas_bytes_out_total ${m.totalBytesOut}\n\n`;

    text += `# HELP canvas_ack_latency_ms Commit to ACK latency\n`;
    text += `# TYPE canvas_ack_latency_ms summary\n`;
    text += `canvas_ack_latency_ms{quantile="0.5"} ${m.p50LatencyMs}\n`;
    text += `canvas_ack_latency_ms{quantile="0.95"} ${m.p95LatencyMs}\n\n`;

    text += `# HELP canvas_process_resident_memory_bytes Resident memory size in bytes\n`;
    text += `# TYPE canvas_process_resident_memory_bytes gauge\n`;
    text += `canvas_process_resident_memory_bytes ${mem.rss}\n\n`;

    text += `# HELP canvas_process_heap_used_bytes Heap memory used in bytes\n`;
    text += `# TYPE canvas_process_heap_used_bytes gauge\n`;
    text += `canvas_process_heap_used_bytes ${mem.heapUsed}\n\n`;

    for (const [code, count] of Object.entries(m.rejectsByCode)) {
      text += `canvas_rejects_total{code="${code}"} ${count}\n`;
    }

    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return text;
  });

  // Anonymous session endpoint (SPEC Section 5)
  app.post('/api/session', async (req, reply) => {
    const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';
    const ip = rawIp.replace(/^.*:/, '');

    if (!rateLimiter.allowSessionCreation(ip)) {
      reply.status(429);
      return { error: 'Session creation rate limit exceeded' };
    }

    const session = await sessionManager.createSession();
    return {
      token: session.token,
      userId: session.user.id,
      limits: {
        inkBurst: 100,
        refillIntervalMs: 2000,
      },
      rulesVersion: session.user.rulesVersion,
    };
  });

  // Rules acceptance endpoint (SPEC Section 7)
  app.post('/api/rules/accept', async (req, reply) => {
    const authHeader = req.headers['authorization'];
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if ((req.query as any)?.token) {
      token = (req.query as any).token;
    }

    const body = req.body as { rulesVersion?: number } | undefined;
    const rulesVersion = body?.rulesVersion || 1;

    if (token) {
      const session = await sessionManager.resumeSession(token);
      if (session) {
        await storage.updateUserRulesVersion(session.user.id, rulesVersion);
        return { accepted: true, rulesVersion, userId: session.user.id };
      }
    }
    return { accepted: true, rulesVersion };
  });

  // Discovery: Spawn location endpoint (SPEC Section 7 & Phase 5)
  app.get('/api/spawn', async () => {
    return storage.getSpawnLocation();
  });

  // Discovery: Activity heatmap / busy spots endpoint (SPEC Section 7 & Phase 5)
  app.get('/api/activity', async (req) => {
    const query = req.query as { limit?: string; since?: string };
    const limit = query.limit ? Math.min(100, Math.max(1, parseInt(query.limit, 10))) : 50;
    const sinceTime = query.since ? new Date(query.since) : new Date(Date.now() - 3600 * 1000);
    return storage.getRecentActivity(sinceTime, limit);
  });

  // Tile index endpoint (SPEC Section 5)
  app.post('/api/tile-index', async (req, reply) => {
    const body = req.body as { tileX: number; tileY: number }[];
    if (!Array.isArray(body)) {
      reply.status(400);
      return { error: 'Expected array of tiles' };
    }
    const tilesToFetch = body.slice(0, 64);
    const records = await storage.getTileIndex(tilesToFetch);
    return records.map((r) => ({
      tileX: r.tileX,
      tileY: r.tileY,
      snapshotVersion: r.snapshotVersion,
      snapshotUrl: r.snapshotKey ? objectStore.getUrl(r.snapshotKey) : null,
      maxStrokeId: r.maxStrokeId,
      strokeCount: r.strokeCount,
      frozen: r.frozen,
    }));
  });

  // Snapshot binary retrieval endpoint (immutable, cached)
  app.get('/snapshot/*', async (req, reply) => {
    const key = (req.params as any)['*'];
    const obj = await objectStore.get(key);
    if (!obj) {
      reply.status(404);
      return { error: 'Snapshot not found' };
    }
    reply.header('Content-Type', obj.contentType);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(Buffer.from(obj.data));
  });

  // Raster pyramid tile retrieval endpoint (SPEC Section 5)
  app.get('/raster/:level/:x/:y.webp', async (req, reply) => {
    const { level, x, y } = req.params as { level: string; x: string; y: string };
    const lvl = parseInt(level, 10);
    const rx = parseInt(x, 10);
    const ry = parseInt(y, 10);

    const record = await storage.getRasterTile(lvl, rx, ry);
    if (!record) {
      reply.status(404);
      return reply.send('');
    }

    const obj = await objectStore.get(record.key);
    if (!obj) {
      reply.status(404);
      return reply.send('');
    }

    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(Buffer.from(obj.data));
  });

  // Kill Switch endpoints (Phase 3)
  app.get('/admin/api/kill-switch', async () => ({
    readOnly: gatewayInstance ? gatewayInstance.isReadOnly : false,
  }));

  app.post('/admin/api/kill-switch', async (req) => {
    const body = req.body as { readOnly?: boolean };
    if (gatewayInstance && typeof body?.readOnly === 'boolean') {
      gatewayInstance.isReadOnly = body.readOnly;
    }
    return { readOnly: gatewayInstance ? gatewayInstance.isReadOnly : false };
  });

  // User Reporting Endpoint (Phase 4, SPEC Section 10)
  app.post('/api/reports', async (req, reply) => {
    const authHeader = req.headers['authorization'];
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if ((req.query as any)?.token) {
      token = (req.query as any).token;
    }

    let session = token ? await sessionManager.resumeSession(token) : null;
    if (!session) {
      session = await sessionManager.createSession();
    }

    const body = req.body as {
      tiles?: { tileX: number; tileY: number }[];
      minTx?: number;
      minTy?: number;
      maxTx?: number;
      maxTy?: number;
      tileX?: number;
      tileY?: number;
      pointX?: number;
      pointY?: number;
      reason: string;
      note?: string;
    };

    if (!body?.reason) {
      reply.status(400);
      return { error: 'reason is required' };
    }

    const tilesToReport: { tileX: number; tileY: number }[] = [];
    if (body.tiles && Array.isArray(body.tiles) && body.tiles.length > 0) {
      tilesToReport.push(...body.tiles);
    } else if (
      body.minTx !== undefined &&
      body.minTy !== undefined &&
      body.maxTx !== undefined &&
      body.maxTy !== undefined
    ) {
      const minTx = Math.min(body.minTx, body.maxTx);
      const maxTx = Math.max(body.minTx, body.maxTx);
      const minTy = Math.min(body.minTy, body.maxTy);
      const maxTy = Math.max(body.minTy, body.maxTy);
      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          tilesToReport.push({ tileX: tx, tileY: ty });
        }
      }
    } else if (body.tileX !== undefined && body.tileY !== undefined) {
      tilesToReport.push({ tileX: body.tileX, tileY: body.tileY });
    }

    if (tilesToReport.length === 0) {
      reply.status(400);
      return { error: 'At least one tile must be specified to report' };
    }

    // Limit to max 64 tiles in a single report
    const cappedTiles = tilesToReport.slice(0, 64);
    const reportIds: number[] = [];
    let anyAutoQuarantined = false;
    const quarantinedTiles: { tileX: number; tileY: number }[] = [];

    for (const t of cappedTiles) {
      const res = await storage.createReport(
        t.tileX,
        t.tileY,
        body.pointX ?? 32768,
        body.pointY ?? 32768,
        session.user.id,
        body.reason,
        body.note
      );
      reportIds.push(res.report.id);
      if (res.autoQuarantined && res.affectedTile && res.quarantinedIds) {
        anyAutoQuarantined = true;
        quarantinedTiles.push(res.affectedTile);
        await moderationService.handleReportQuarantine(
          res.affectedTile.tileX,
          res.affectedTile.tileY,
          res.quarantinedIds
        );
      }
    }

    return {
      success: true,
      reportId: reportIds[0],
      reportIds,
      count: reportIds.length,
      autoQuarantined: anyAutoQuarantined,
      quarantinedTiles,
    };
  });

  // Admin Authentication Helper
  const ADMIN_SECRET = process.env.ADMIN_TOKEN || 'admin-secret-token';
  const checkAdminAuth = (req: any, reply: any): boolean => {
    const authHeader = req.headers['authorization'];
    const customHeader = req.headers['x-admin-token'];
    const queryToken = (req.query as any)?.admin_token;

    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (customHeader) {
      token = customHeader;
    } else if (queryToken) {
      token = queryToken;
    }

    if (token !== ADMIN_SECRET) {
      reply.status(401);
      reply.send({ error: 'Unauthorized: Valid admin token required' });
      return false;
    }
    return true;
  };

  // Admin Review Queue
  app.get('/admin/api/review-queue', async (req, reply) => {
    if (!checkAdminAuth(req, reply)) return;
    const statusQuery = (req.query as any)?.status;
    const status = statusQuery !== undefined ? parseInt(statusQuery, 10) : undefined;
    const items = await storage.getReviewQueue(status);
    return { items };
  });

  // Admin Review Queue Action
  app.post('/admin/api/review/:id/action', async (req, reply) => {
    if (!checkAdminAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const reviewId = parseInt(id, 10);
    const body = req.body as {
      action: 'restore' | 'hide' | 'ban_user';
      strokeIds?: number[];
      userId?: string;
      reason?: string;
    };

    if (body.action === 'restore' && body.strokeIds && body.strokeIds.length > 0) {
      await moderationService.restoreStrokes(body.strokeIds, 'admin', body.reason);
    } else if (body.action === 'hide' && body.strokeIds && body.strokeIds.length > 0) {
      await moderationService.hideStrokes(body.strokeIds, 'admin', body.reason);
    } else if (body.action === 'ban_user' && body.userId) {
      await moderationService.setUserBan(body.userId, true, 'admin', body.reason);
    }

    await storage.resolveReviewItem(reviewId);
    return { success: true };
  });

  // Admin Bulk Action
  app.post('/admin/api/bulk-action', async (req, reply) => {
    if (!checkAdminAuth(req, reply)) return;
    const body = req.body as {
      userId?: string;
      tileX?: number;
      tileY?: number;
      minTx?: number;
      minTy?: number;
      maxTx?: number;
      maxTy?: number;
      since?: string;
      until?: string;
      reason?: string;
    };

    const options = {
      userId: body.userId,
      tileX: body.tileX,
      tileY: body.tileY,
      minTx: body.minTx,
      minTy: body.minTy,
      maxTx: body.maxTx,
      maxTy: body.maxTy,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
    };

    const result = await moderationService.bulkHide(options, 'admin', body.reason);
    return { success: true, affectedTiles: result.affectedTiles, strokeCount: result.strokeIds.length };
  });

  // Admin User Ban/Unban
  app.post('/admin/api/users/:id/ban', async (req, reply) => {
    if (!checkAdminAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = req.body as { banned: boolean; reason?: string };
    await moderationService.setUserBan(id, !!body.banned, 'admin', body.reason);
    return { success: true, userId: id, banned: !!body.banned };
  });

  // Admin Audit Log
  app.get('/admin/api/actions', async (req, reply) => {
    if (!checkAdminAuth(req, reply)) return;
    const limitQuery = (req.query as any)?.limit;
    const limit = limitQuery ? parseInt(limitQuery, 10) : 100;
    const actions = await storage.getModActions(limit);
    return { actions };
  });

  // Admin Stats
  app.get('/admin/api/stats', async (req, reply) => {
    if (!checkAdminAuth(req, reply)) return;
    const stats = await storage.getStats();
    return { stats };
  });

  // Admin Automated Scan Trigger
  app.post('/admin/api/scan', async (req, reply) => {
    if (!checkAdminAuth(req, reply)) return;
    const body = req.body as { tileX: number; tileY: number; fakeImageHex?: string };
    const buf = body.fakeImageHex ? Buffer.from(body.fakeImageHex, 'hex') : Buffer.alloc(100);
    const result = await moderationService.scanTile(body.tileX, body.tileY, buf);
    return { result };
  });

  const port = customPort !== undefined ? customPort : Number(process.env.PORT || 3001);

  // Start HTTP listening
  await app.listen({ port, host: '0.0.0.0' });
  const server = app.server;
  const actualPort = (server.address() as any)?.port || port;

  // Mount WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });
  const gateway = new WebSocketGateway(wss, storage, sessionManager);
  // Share the same rateLimiter and inkManager instances
  gateway.rateLimiter = rateLimiter;
  gateway.inkManager = inkManager;
  gatewayInstance = gateway;

  return {
    app,
    wss,
    gateway,
    storage,
    sessionManager,
    objectStore,
    moderationService,
    port: actualPort,
    close: async () => {
      wss.close();
      await app.close();
      await storage.close();
    },
  };
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  createServer()
    .then((inst) => {
      console.log(`🚀 Infinite Canvas Server running on http://localhost:${inst.port}`);
    })
    .catch((err) => {
      console.error('Fatal server startup error:', err);
      process.exit(1);
    });
}
