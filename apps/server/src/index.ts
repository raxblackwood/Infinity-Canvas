import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { WebSocketServer } from 'ws';
import { createStorage, Storage } from './db/storage.js';
import { SessionManager } from './session/sessionManager.js';
import { WebSocketGateway } from './gateway/gateway.js';
import { getObjectStore, ObjectStore } from './storage/objectStore.js';

export {
  createStorage,
  type Storage,
  InMemoryStorage,
  PostgresStorage,
  type UserRecord,
  type TileRecord,
  type StrokeRecord,
  type BakeJobRecord,
} from './db/storage.js';
export {
  getObjectStore,
  type ObjectStore,
  MemoryObjectStore,
  S3ObjectStore,
} from './storage/objectStore.js';

export interface ServerInstance {
  app: FastifyInstance;
  wss: WebSocketServer;
  gateway: WebSocketGateway;
  storage: Storage;
  sessionManager: SessionManager;
  objectStore: ObjectStore;
  port: number;
  close: () => Promise<void>;
}

export async function createServer(customPort?: number, customStorage?: Storage): Promise<ServerInstance> {
  const storage = customStorage || (await createStorage());
  const sessionManager = new SessionManager(storage);
  const objectStore = getObjectStore();

  const app = fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: '*',
  });

  // Health checks
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ready' }));

  // Anonymous session endpoint (SPEC Section 5)
  app.post('/api/session', async (req) => {
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

  // Rules acceptance endpoint
  app.post('/api/rules/accept', async (req, reply) => {
    return { accepted: true, rulesVersion: 1 };
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

  const port = customPort || Number(process.env.PORT || 3001);

  // Start HTTP listening
  await app.listen({ port, host: '0.0.0.0' });
  const server = app.server;

  // Mount WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });
  const gateway = new WebSocketGateway(wss, storage, sessionManager);

  return {
    app,
    wss,
    gateway,
    storage,
    sessionManager,
    objectStore,
    port,
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
