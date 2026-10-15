import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { WebSocketServer } from 'ws';
import { createStorage, Storage } from './db/storage.js';
import { SessionManager } from './session/sessionManager.js';
import { WebSocketGateway } from './gateway/gateway.js';

export interface ServerInstance {
  app: FastifyInstance;
  wss: WebSocketServer;
  gateway: WebSocketGateway;
  storage: Storage;
  sessionManager: SessionManager;
  port: number;
  close: () => Promise<void>;
}

export async function createServer(customPort?: number, customStorage?: Storage): Promise<ServerInstance> {
  const storage = customStorage || (await createStorage());
  const sessionManager = new SessionManager(storage);

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
