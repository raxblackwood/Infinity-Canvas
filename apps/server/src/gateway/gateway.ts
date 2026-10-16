import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import crypto from 'crypto';
import {
  WsMessageType,
  decodeClientHello,
  encodeServerWelcome,
  decodeClientSubscribe,
  decodeClientStrokeCommit,
  decodeStroke,
  encodeServerTileDelta,
  encodeServerStrokeAck,
  encodeServerStrokeReject,
  encodeServerStrokesHidden,
  encodeServerLiveBegin,
  encodeServerLivePoints,
  encodeServerLiveEnd,
  encodeServerTileFrozen,
  encodeServerInk,
  decodeClientStrokeBegin,
  decodeClientStrokePreview,
  ErrorCode,
  MAX_SUBSCRIBED_TILES,
  MAX_POINTS,
  UNDO_WINDOW_MS,
} from '@infinite-canvas/shared';
import { Storage, UserRecord } from '../db/storage.js';
import { SessionManager } from '../session/sessionManager.js';
import { InkManager } from '../limiter/inkLimiter.js';
import { RateLimiter, ConnectionPreviewLimiter } from '../limiter/rateLimiter.js';

interface ClientState {
  ws: WebSocket;
  ip: string;
  user?: UserRecord;
  subscribedTiles: Set<string>; // "tx,ty"
  liveSubscriptions: Set<string>; // "tx,ty" where live=true
  activePreviews: Map<number, number>; // clientStrokeId -> liveId
  previewLimiter: ConnectionPreviewLimiter;
  isAlive: boolean;
}

export class WebSocketGateway {
  private wss: WebSocketServer;
  private storage: Storage;
  private sessionManager: SessionManager;
  private clients: Set<ClientState> = new Set();
  private tileSubscribers: Map<string, Set<ClientState>> = new Map(); // "tx,ty" -> clients
  private nextLiveId = 1;
  public rateLimiter = new RateLimiter();
  public inkManager = new InkManager();
  public isReadOnly = false;

  // Observability & Metrics (SPEC Section 12)
  public totalBytesOut = 0;
  public totalStrokesCommitted = 0;
  public rejectsByCode: Map<number, number> = new Map();
  private recentLatencies: number[] = [];

  constructor(wss: WebSocketServer, storage: Storage, sessionManager: SessionManager) {
    this.wss = wss;
    this.storage = storage;
    this.sessionManager = sessionManager;

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.onConnection(ws, req);
    });
  }

  public sendTo(ws: WebSocket, buf: Uint8Array): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(buf);
      this.totalBytesOut += buf.length;
    }
  }

  public recordLatency(ms: number): void {
    this.recentLatencies.push(ms);
    if (this.recentLatencies.length > 500) {
      this.recentLatencies.shift();
    }
  }

  public recordReject(code: number): void {
    this.rejectsByCode.set(code, (this.rejectsByCode.get(code) || 0) + 1);
  }

  public getMetrics() {
    const latencies = [...this.recentLatencies].sort((a, b) => a - b);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

    const tileSubs: { tile: string; subscribers: number }[] = [];
    for (const [tile, subs] of this.tileSubscribers.entries()) {
      tileSubs.push({ tile, subscribers: subs.size });
    }
    tileSubs.sort((a, b) => b.subscribers - a.subscribers);

    const rejects: Record<number, number> = {};
    for (const [code, count] of this.rejectsByCode.entries()) {
      rejects[code] = count;
    }

    return {
      openConnections: this.clients.size,
      totalStrokesCommitted: this.totalStrokesCommitted,
      totalBytesOut: this.totalBytesOut,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      topSubscribedTiles: tileSubs.slice(0, 10),
      rejectsByCode: rejects,
    };
  }

  private onConnection = (ws: WebSocket, req: IncomingMessage): void => {
    const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const ip = rawIp.replace(/^.*:/, '');

    if (!this.rateLimiter.allowConnection(ip)) {
      ws.close(1008, 'Connection limit exceeded');
      return;
    }

    const clientState: ClientState = {
      ws,
      ip,
      subscribedTiles: new Set(),
      liveSubscriptions: new Set(),
      activePreviews: new Map(),
      previewLimiter: new ConnectionPreviewLimiter(),
      isAlive: true,
    };
    this.clients.add(clientState);

    ws.on('message', async (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const buf = Buffer.isBuffer(data) ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
        await this.handleMessage(clientState, buf);
      } catch (err) {
        // Drop malformed frame without crashing
      }
    });

    ws.on('close', () => {
      this.cleanupClient(clientState);
    });

    ws.on('error', () => {
      this.cleanupClient(clientState);
    });
  };

  private cleanupClient(client: ClientState): void {
    this.rateLimiter.releaseConnection(client.ip);
    this.clients.delete(client);
    for (const tileKey of client.subscribedTiles) {
      const subs = this.tileSubscribers.get(tileKey);
      if (subs) {
        subs.delete(client);
        if (subs.size === 0) {
          this.tileSubscribers.delete(tileKey);
        }
      }
    }
  }

  private async handleMessage(client: ClientState, buf: Uint8Array): Promise<void> {
    if (buf.length === 0) return;
    const msgType = buf[0];

    // Handshake
    if (msgType === WsMessageType.HELLO) {
      const hello = decodeClientHello(buf);
      let session = await this.sessionManager.resumeSession(hello.token);
      if (!session) {
        const tokenBytes = Buffer.from(hello.token, 'hex');
        const tokenHash = crypto.createHash('sha256').update(tokenBytes).digest();
        const user = await this.storage.findOrCreateUser(tokenHash);
        session = { user, token: hello.token };
      }

      if (session.user.banned) {
        client.ws.close(1008, 'User is banned');
        return;
      }

      client.user = session.user;
      const inkBucket = this.inkManager.getBucket(session.user.id);
      const welcome = encodeServerWelcome({
        userId: session.user.id,
        inkBurst: 100,
        inkBalance: inkBucket.getBalance(),
        serverTime: Date.now(),
        readOnly: this.isReadOnly,
      });
      client.ws.send(welcome);
      return;
    }

    // Require authenticated session for all other messages
    if (!client.user) {
      client.ws.close(1008, 'Unauthenticated');
      return;
    }

    switch (msgType) {
      case WsMessageType.PING: {
        client.ws.send(new Uint8Array([WsMessageType.PONG]));
        break;
      }

      case WsMessageType.SUBSCRIBE: {
        const sub = decodeClientSubscribe(buf);
        if (client.subscribedTiles.size + sub.tiles.length > MAX_SUBSCRIBED_TILES) {
          return;
        }

        for (const t of sub.tiles) {
          const key = `${t.tileX},${t.tileY}`;
          client.subscribedTiles.add(key);
          if (t.live) {
            client.liveSubscriptions.add(key);
          }

          let subs = this.tileSubscribers.get(key);
          if (!subs) {
            subs = new Set();
            this.tileSubscribers.set(key, subs);
          }
          subs.add(client);

          // DEC-012: Serve tile history as deltas since sinceStrokeId
          const strokes = await this.storage.getStrokesSince(t.tileX, t.tileY, t.sinceStrokeId);
          if (strokes.length > 0) {
            const deltaBuf = encodeServerTileDelta(
              t.tileX,
              t.tileY,
              strokes.map((s) => ({ id: s.id, strokeBytes: s.data }))
            );
            client.ws.send(deltaBuf);
          }
        }
        break;
      }

      case WsMessageType.UNSUBSCRIBE: {
        // Unsubscribe from tiles
        break;
      }

      case WsMessageType.STROKE_BEGIN: {
        const begin = decodeClientStrokeBegin(buf);
        const tileKey = `${begin.tileX},${begin.tileY}`;

        // Amendment 6: Drop preview if client is not subscribed to tile
        if (!client.subscribedTiles.has(tileKey)) {
          return;
        }

        // Amendment 6: Max 8 open previews per connection
        if (!client.previewLimiter.canBeginPreview(begin.clientStrokeId)) {
          return;
        }

        const liveId = this.nextLiveId++;
        client.activePreviews.set(begin.clientStrokeId, liveId);

        // Fan out live begin to subscribers of this tile with live=true
        const subs = this.tileSubscribers.get(tileKey);
        if (subs) {
          const liveBeginBuf = encodeServerLiveBegin(
            begin.tileX,
            begin.tileY,
            liveId,
            begin.colorIndex,
            begin.widthIndex
          );
          for (const s of subs) {
            if (s !== client && s.liveSubscriptions.has(tileKey) && s.ws.readyState === WebSocket.OPEN) {
              s.ws.send(liveBeginBuf);
            }
          }
        }
        break;
      }

      case WsMessageType.STROKE_PREVIEW: {
        const preview = decodeClientStrokePreview(buf);
        const liveId = client.activePreviews.get(preview.clientStrokeId);
        if (!liveId) return;

        // Amendment 6: Max 4 KB/s preview data per connection
        if (!client.previewLimiter.canSendPoints(buf.length)) {
          return;
        }

        const livePtsBuf = encodeServerLivePoints(liveId, preview.points);
        for (const tileKey of client.subscribedTiles) {
          const subs = this.tileSubscribers.get(tileKey);
          if (subs) {
            for (const s of subs) {
              if (s !== client && s.liveSubscriptions.has(tileKey) && s.ws.readyState === WebSocket.OPEN) {
                s.ws.send(livePtsBuf);
              }
            }
          }
        }
        break;
      }

      case WsMessageType.STROKE_COMMIT: {
        const commitStart = Date.now();
        const commit = decodeClientStrokeCommit(buf);
        client.previewLimiter.endPreview(commit.clientStrokeId);

        if (this.isReadOnly) {
          this.recordReject(ErrorCode.READ_ONLY);
          this.sendTo(client.ws, encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.READ_ONLY));
          return;
        }

        // Strict binary validation
        let decodedStroke;
        try {
          decodedStroke = decodeStroke(commit.strokeBytes);
        } catch {
          this.recordReject(ErrorCode.BAD_STROKE);
          this.sendTo(client.ws, encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.BAD_STROKE));
          return;
        }

        if (
          decodedStroke.points.length === 0 ||
          decodedStroke.points.length > MAX_POINTS ||
          decodedStroke.colorIndex < 0 ||
          decodedStroke.colorIndex > 15 ||
          decodedStroke.widthIndex < 0 ||
          decodedStroke.widthIndex > 5
        ) {
          this.recordReject(ErrorCode.BAD_STROKE);
          this.sendTo(client.ws, encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.BAD_STROKE));
          return;
        }

        // Validate all coordinates are strictly within tile bounds [0, 65535]
        for (const pt of decodedStroke.points) {
          if (pt.x < 0 || pt.x > 65535 || pt.y < 0 || pt.y > 65535) {
            this.recordReject(ErrorCode.BAD_STROKE);
            this.sendTo(client.ws, encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.BAD_STROKE));
            return;
          }
        }

        // Check tile freeze
        const tile = await this.storage.getTile(commit.tileX, commit.tileY);
        if (tile.frozen) {
          this.recordReject(ErrorCode.TILE_FULL);
          this.sendTo(client.ws, encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.TILE_FULL));
          return;
        }

        // Check Ink
        const inkBucket = this.inkManager.getBucket(client.user.id);
        const inkCheck = inkBucket.tryConsume(decodedStroke.points.length);
        if (!inkCheck.allowed) {
          this.recordReject(ErrorCode.INK_EMPTY);
          this.sendTo(client.ws, encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.INK_EMPTY));
          return;
        }

        // Commit to database
        try {
          const saveResult = await this.storage.saveStroke(
            commit.tileX,
            commit.tileY,
            client.user.id,
            commit.strokeBytes
          );

          this.totalStrokesCommitted++;
          this.recordLatency(Date.now() - commitStart);

          // 1. Send ACK to author with remaining ink
          this.sendTo(client.ws, encodeServerStrokeAck(commit.clientStrokeId, saveResult.id, inkCheck.remaining));

          // 2. Broadcast TILE_DELTA to all subscribers of this tile
          const tileKey = `${commit.tileX},${commit.tileY}`;
          const subs = this.tileSubscribers.get(tileKey);
          if (subs) {
            const deltaBuf = encodeServerTileDelta(commit.tileX, commit.tileY, [
              { id: saveResult.id, strokeBytes: commit.strokeBytes },
            ]);
            for (const s of subs) {
              this.sendTo(s.ws, deltaBuf);
            }

            // End active preview if one was open
            const liveId = client.activePreviews.get(commit.clientStrokeId);
            if (liveId) {
              client.activePreviews.delete(commit.clientStrokeId);
              const liveEndBuf = encodeServerLiveEnd(liveId, saveResult.id);
              for (const s of subs) {
                if (s !== client && s.liveSubscriptions.has(tileKey)) {
                  this.sendTo(s.ws, liveEndBuf);
                }
              }
            }

            // If tile became frozen at TILE_STROKE_CAP, broadcast TILE_FROZEN (0x89)
            if (saveResult.frozen) {
              const frozenBuf = encodeServerTileFrozen(commit.tileX, commit.tileY);
              for (const s of subs) {
                this.sendTo(s.ws, frozenBuf);
              }
            }
          }
        } catch {
          // Refund ink consumed if save failed
          inkBucket.refund(decodedStroke.points.length);
          this.recordReject(ErrorCode.BAD_STROKE);
          this.sendTo(client.ws, encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.BAD_STROKE));
        }
        break;
      }

      case WsMessageType.UNDO: {
        const undone = await this.storage.undoLastStroke(client.user.id, UNDO_WINDOW_MS);
        if (undone) {
          // Refund exact stroke ink
          let ptsCount = 0;
          try {
            const decoded = decodeStroke(undone.data);
            ptsCount = decoded.points.length;
          } catch {}
          const inkBucket = this.inkManager.getBucket(client.user.id);
          const newBalance = inkBucket.refund(ptsCount);

          const tileKey = `${undone.tileX},${undone.tileY}`;
          const subs = this.tileSubscribers.get(tileKey);
          if (subs) {
            const hiddenBuf = encodeServerStrokesHidden(undone.tileX, undone.tileY, [undone.id]);
            for (const s of subs) {
              if (s.ws.readyState === WebSocket.OPEN) {
                s.ws.send(hiddenBuf);
              }
            }
          }

          // Send updated ink balance to user
          client.ws.send(encodeServerInk(newBalance));
        }
        break;
      }
    }
  }

  public broadcastStrokesHidden(tileX: number, tileY: number, strokeIds: number[]): void {
    if (strokeIds.length === 0) return;
    const tileKey = `${tileX},${tileY}`;
    const subs = this.tileSubscribers.get(tileKey);
    if (!subs || subs.size === 0) return;

    const hiddenBuf = encodeServerStrokesHidden(tileX, tileY, strokeIds);
    for (const s of subs) {
      if (s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(hiddenBuf);
      }
    }
  }

  get connectedClientsCount(): number {
    return this.clients.size;
  }
}
