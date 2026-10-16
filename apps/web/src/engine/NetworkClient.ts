import {
  WsMessageType,
  encodeClientHello,
  decodeServerWelcome,
  encodeClientSubscribe,
  decodeServerTileDelta,
  encodeClientStrokeCommit,
  encodeClientStrokeBegin,
  encodeClientStrokePreview,
  decodeServerLiveBegin,
  decodeServerLivePoints,
  decodeServerLiveEnd,
  decodeServerStrokeAck,
  decodeServerStrokeReject,
  decodeServerStrokesHidden,
  encodeClientUndo,
  decodeServerTileFrozen,
  decodeServerInk,
  decodeStroke,
  decodeTileSnapshot,
  TileSubEntry,
  LocalPoint,
  ServerWelcome,
  ErrorCode,
} from '@infinite-canvas/shared';
import { CanvasEngine } from './CanvasEngine.js';
import { StoredStroke } from './SpatialIndex.js';

export interface RemoteLiveStroke {
  liveId: number;
  tileX: number;
  tileY: number;
  colorIndex: number;
  widthIndex: number;
  points: LocalPoint[];
}

export class NetworkClient {
  private ws: WebSocket | null = null;
  private engine: CanvasEngine;
  public token: string | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimeout: number | null = null;

  // Track max known stroke ID per tile for reconnect catchup
  private tileMaxStrokeIds: Map<string, number> = new Map();
  // Remote peer live strokes
  private remoteLiveStrokes: Map<number, RemoteLiveStroke> = new Map();

  // Status callbacks
  public onConnectionChange?: (connected: boolean) => void;
  public onInkChange?: (ink: number) => void;
  public onTileFrozen?: (tileX: number, tileY: number) => void;
  public onStrokeReject?: (clientStrokeId: number, errorCode: number) => void;
  public onReadOnlyChange?: (readOnly: boolean) => void;
  public welcomeInfo: ServerWelcome | null = null;
  public currentInk = 100;

  constructor(engine: CanvasEngine) {
    this.engine = engine;
    this.initToken();
  }

  private async initToken(): Promise<void> {
    let token = localStorage.getItem('infinite_canvas_token');
    if (!token) {
      try {
        const res = await fetch('/api/session', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          token = data.token;
          localStorage.setItem('infinite_canvas_token', token!);
        }
      } catch {
        // Fallback: generate local token if offline
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        token = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        localStorage.setItem('infinite_canvas_token', token);
      }
    }
    this.token = token;
    this.connect();
  }

  connect(): void {
    if (this.ws || this.isConnecting || !this.token) return;
    this.isConnecting = true;

    // Connect through Vite's WebSocket proxy (/ws)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.onConnectionChange?.(true);

      // Send HELLO with our 32-byte token
      ws.send(encodeClientHello(this.token!, 1));
    };

    ws.onmessage = (event: MessageEvent) => {
      const buf = new Uint8Array(event.data as ArrayBuffer);
      this.handleServerMessage(buf);
    };

    ws.onclose = () => {
      this.ws = null;
      this.isConnecting = false;
      this.onConnectionChange?.(false);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    this.ws = ws;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout !== null) return;
    this.reconnectAttempts++;

    // Exponential backoff: 1s to 30s with jitter
    const delay = Math.min(30000, 1000 * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 1000);
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  private handleServerMessage(buf: Uint8Array): void {
    if (buf.length === 0) return;
    const type = buf[0];

    switch (type) {
      case WsMessageType.WELCOME: {
        this.welcomeInfo = decodeServerWelcome(buf);
        this.currentInk = this.welcomeInfo.inkBalance;
        this.onInkChange?.(this.currentInk);
        this.onReadOnlyChange?.(this.welcomeInfo.readOnly);
        // Subscribe to current visible tiles around camera
        this.syncVisibleTiles();
        break;
      }

      case WsMessageType.TILE_DELTA: {
        const delta = decodeServerTileDelta(buf);
        const tileKey = `${delta.tileX},${delta.tileY}`;
        let currentMax = this.tileMaxStrokeIds.get(tileKey) || 0;

        for (const s of delta.strokes) {
          if (s.id > currentMax) currentMax = s.id;

          try {
            const decoded = decodeStroke(s.strokeBytes);
            let minX = decoded.points[0].x;
            let minY = decoded.points[0].y;
            let maxX = decoded.points[0].x;
            let maxY = decoded.points[0].y;

            for (const pt of decoded.points) {
              if (pt.x < minX) minX = pt.x;
              if (pt.y < minY) minY = pt.y;
              if (pt.x > maxX) maxX = pt.x;
              if (pt.y > maxY) maxY = pt.y;
            }

            const stored: StoredStroke = {
              id: s.id,
              tileX: delta.tileX,
              tileY: delta.tileY,
              colorIndex: decoded.colorIndex,
              widthIndex: decoded.widthIndex,
              points: decoded.points,
              minX,
              minY,
              maxX,
              maxY,
            };

            this.engine.renderer.addStroke(stored);
          } catch {
            // Ignore corrupted stroke
          }
        }

        this.tileMaxStrokeIds.set(tileKey, currentMax);
        this.engine.renderer.markDirty();
        break;
      }

      case WsMessageType.LIVE_BEGIN: {
        const lb = decodeServerLiveBegin(buf);
        this.remoteLiveStrokes.set(lb.liveId, {
          liveId: lb.liveId,
          tileX: lb.tileX,
          tileY: lb.tileY,
          colorIndex: lb.colorIndex,
          widthIndex: lb.widthIndex,
          points: [],
        });
        break;
      }

      case WsMessageType.LIVE_POINTS: {
        const lp = decodeServerLivePoints(buf);
        const stroke = this.remoteLiveStrokes.get(lp.liveId);
        if (stroke) {
          stroke.points.push(...lp.points);
          this.engine.renderer.markDirty();
        }
        break;
      }

      case WsMessageType.LIVE_END: {
        const le = decodeServerLiveEnd(buf);
        this.remoteLiveStrokes.delete(le.liveId);
        this.engine.renderer.markDirty();
        break;
      }

      case WsMessageType.STROKE_ACK: {
        const ack = decodeServerStrokeAck(buf);
        this.currentInk = ack.inkBalance;
        this.onInkChange?.(this.currentInk);
        break;
      }

      case WsMessageType.STROKE_REJECT: {
        const reject = decodeServerStrokeReject(buf);
        console.warn('Stroke rejected by server. Code:', reject.errorCode);
        this.onStrokeReject?.(reject.clientStrokeId, reject.errorCode);
        break;
      }

      case WsMessageType.STROKES_HIDDEN: {
        const hidden = decodeServerStrokesHidden(buf);
        for (const strokeId of hidden.strokeIds) {
          this.engine.renderer.removeStroke(hidden.tileX, hidden.tileY, strokeId);
        }
        this.engine.renderer.markDirty();
        break;
      }

      case WsMessageType.TILE_FROZEN: {
        const frozen = decodeServerTileFrozen(buf);
        this.onTileFrozen?.(frozen.tileX, frozen.tileY);
        break;
      }

      case WsMessageType.INK: {
        const ink = decodeServerInk(buf);
        this.currentInk = ink.currentInk;
        this.onInkChange?.(this.currentInk);
        break;
      }
    }
  }

  private checkedTileSnapshots: Set<string> = new Set();

  async syncVisibleTiles(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Determine current visible tiles
    const cam = this.engine.camera;
    const vp = this.engine.renderer.getViewport();
    const halfW = vp.width / 2;
    const halfH = vp.height / 2;

    const minTx = Math.floor(cam.tileX + cam.offsetX - halfW / cam.scale);
    const maxTx = Math.floor(cam.tileX + cam.offsetX + halfW / cam.scale);
    const minTy = Math.floor(cam.tileY + cam.offsetY - halfH / cam.scale);
    const maxTy = Math.floor(cam.tileY + cam.offsetY + halfH / cam.scale);

    const neededTiles: { tileX: number; tileY: number }[] = [];
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        neededTiles.push({ tileX: tx, tileY: ty });
      }
    }

    if (neededTiles.length === 0) return;

    // Check which tiles need snapshot indexing
    const unindexedTiles = neededTiles.filter(
      (t) => !this.checkedTileSnapshots.has(`${t.tileX},${t.tileY}`)
    );

    if (unindexedTiles.length > 0) {
      try {
        const res = await fetch('/api/tile-index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(unindexedTiles.slice(0, 64)),
        });

        if (res.ok) {
          const indexList: {
            tileX: number;
            tileY: number;
            snapshotVersion: number;
            snapshotUrl: string | null;
            maxStrokeId: number;
            strokeCount: number;
            frozen: boolean;
          }[] = await res.json();

          for (const item of indexList) {
            const key = `${item.tileX},${item.tileY}`;
            this.checkedTileSnapshots.add(key);

            if (item.snapshotUrl) {
              try {
                const snapRes = await fetch(item.snapshotUrl);
                if (snapRes.ok) {
                  const snapBuf = new Uint8Array(await snapRes.arrayBuffer());
                  const snapshot = decodeTileSnapshot(snapBuf);

                  for (const strokeItem of snapshot.strokes) {
                    try {
                      const decoded = decodeStroke(strokeItem.data);
                      let minX = decoded.points[0].x;
                      let minY = decoded.points[0].y;
                      let maxX = decoded.points[0].x;
                      let maxY = decoded.points[0].y;
                      for (const pt of decoded.points) {
                        if (pt.x < minX) minX = pt.x;
                        if (pt.y < minY) minY = pt.y;
                        if (pt.x > maxX) maxX = pt.x;
                        if (pt.y > maxY) maxY = pt.y;
                      }

                      this.engine.renderer.addStroke({
                        id: strokeItem.id,
                        tileX: item.tileX,
                        tileY: item.tileY,
                        colorIndex: decoded.colorIndex,
                        widthIndex: decoded.widthIndex,
                        points: decoded.points,
                        minX,
                        minY,
                        maxX,
                        maxY,
                      });
                    } catch {}
                  }

                  this.tileMaxStrokeIds.set(key, snapshot.maxStrokeId);
                  this.engine.renderer.markDirty();
                }
              } catch (e) {
                console.warn('Failed to load snapshot for tile', key, e);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch tile index:', err);
      }
    }

    const subs: TileSubEntry[] = [];
    for (const t of neededTiles) {
      const key = `${t.tileX},${t.tileY}`;
      const since = this.tileMaxStrokeIds.get(key) || 0;
      subs.push({
        tileX: t.tileX,
        tileY: t.tileY,
        sinceStrokeId: since,
        live: true,
      });
    }

    if (subs.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeClientSubscribe(subs));
    }
  }

  sendStrokeCommit(clientStrokeId: number, tileX: number, tileY: number, strokeBytes: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeClientStrokeCommit(clientStrokeId, tileX, tileY, strokeBytes));
  }

  sendStrokeBegin(clientStrokeId: number, tileX: number, tileY: number, colorIndex: number, widthIndex: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeClientStrokeBegin(clientStrokeId, tileX, tileY, colorIndex, widthIndex));
  }

  sendStrokePreview(clientStrokeId: number, points: LocalPoint[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeClientStrokePreview(clientStrokeId, points));
  }

  getRemoteLiveStrokes(): RemoteLiveStroke[] {
    return Array.from(this.remoteLiveStrokes.values());
  }

  sendUndo(strokeId = 0): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeClientUndo(strokeId));
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
