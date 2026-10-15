import { WebSocketServer, WebSocket } from 'ws';
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
  decodeClientStrokeBegin,
  decodeClientStrokePreview,
  ErrorCode,
  MAX_SUBSCRIBED_TILES,
  MAX_POINTS,
  UNDO_WINDOW_MS,
} from '@infinite-canvas/shared';
import { Storage, UserRecord } from '../db/storage.js';
import { SessionManager } from '../session/sessionManager.js';

interface ClientState {
  ws: WebSocket;
  user?: UserRecord;
  subscribedTiles: Set<string>; // "tx,ty"
  liveSubscriptions: Set<string>; // "tx,ty" where live=true
  activePreviews: Map<number, number>; // clientStrokeId -> liveId
  isAlive: boolean;
}

export class WebSocketGateway {
  private wss: WebSocketServer;
  private storage: Storage;
  private sessionManager: SessionManager;
  private clients: Set<ClientState> = new Set();
  private tileSubscribers: Map<string, Set<ClientState>> = new Map(); // "tx,ty" -> clients
  private nextLiveId = 1;
  public isReadOnly = false;

  constructor(wss: WebSocketServer, storage: Storage, sessionManager: SessionManager) {
    this.wss = wss;
    this.storage = storage;
    this.sessionManager = sessionManager;

    this.wss.on('connection', this.onConnection);
  }

  private onConnection = (ws: WebSocket): void => {
    const clientState: ClientState = {
      ws,
      subscribedTiles: new Set(),
      liveSubscriptions: new Set(),
      activePreviews: new Map(),
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
        // If not found, create new session with this token
        const tokenHash = Buffer.from(hello.token, 'hex');
        const user = await this.storage.findOrCreateUser(tokenHash);
        session = { user, token: hello.token };
      }

      if (session.user.banned) {
        client.ws.close(1008, 'User is banned');
        return;
      }

      client.user = session.user;
      const welcome = encodeServerWelcome({
        userId: session.user.id,
        inkBurst: 100,
        inkBalance: 100,
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
        const commit = decodeClientStrokeCommit(buf);

        if (this.isReadOnly) {
          client.ws.send(encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.READ_ONLY));
          return;
        }

        // Strict binary validation
        let decodedStroke;
        try {
          decodedStroke = decodeStroke(commit.strokeBytes);
        } catch {
          client.ws.send(encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.BAD_STROKE));
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
          client.ws.send(encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.BAD_STROKE));
          return;
        }

        // Check tile freeze
        const tile = await this.storage.getTile(commit.tileX, commit.tileY);
        if (tile.frozen) {
          client.ws.send(encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.TILE_FULL));
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

          // 1. Send ACK to author
          client.ws.send(encodeServerStrokeAck(commit.clientStrokeId, saveResult.id, 100));

          // 2. Broadcast TILE_DELTA to all subscribers of this tile
          const tileKey = `${commit.tileX},${commit.tileY}`;
          const subs = this.tileSubscribers.get(tileKey);
          if (subs) {
            const deltaBuf = encodeServerTileDelta(commit.tileX, commit.tileY, [
              { id: saveResult.id, strokeBytes: commit.strokeBytes },
            ]);
            for (const s of subs) {
              if (s.ws.readyState === WebSocket.OPEN) {
                s.ws.send(deltaBuf);
              }
            }

            // End active preview if one was open
            const liveId = client.activePreviews.get(commit.clientStrokeId);
            if (liveId) {
              client.activePreviews.delete(commit.clientStrokeId);
              const liveEndBuf = encodeServerLiveEnd(liveId, saveResult.id);
              for (const s of subs) {
                if (s !== client && s.liveSubscriptions.has(tileKey) && s.ws.readyState === WebSocket.OPEN) {
                  s.ws.send(liveEndBuf);
                }
              }
            }
          }
        } catch {
          client.ws.send(encodeServerStrokeReject(commit.clientStrokeId, ErrorCode.BAD_STROKE));
        }
        break;
      }

      case WsMessageType.UNDO: {
        const undone = await this.storage.undoLastStroke(client.user.id, UNDO_WINDOW_MS);
        if (undone) {
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
        }
        break;
      }
    }
  }

  get connectedClientsCount(): number {
    return this.clients.size;
  }
}
