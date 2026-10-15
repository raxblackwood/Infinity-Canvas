// WebSocket Message Types (SPEC Section 5)
export enum WsMessageType {
  // Client -> Server
  HELLO = 0x01,
  SUBSCRIBE = 0x02,
  UNSUBSCRIBE = 0x03,
  STROKE_BEGIN = 0x04,
  STROKE_PREVIEW = 0x05,
  STROKE_COMMIT = 0x06,
  STROKE_CANCEL = 0x07,
  UNDO = 0x08,
  PING = 0x0f,

  // Server -> Client
  WELCOME = 0x81,
  TILE_DELTA = 0x82,
  LIVE_BEGIN = 0x83,
  LIVE_POINTS = 0x84,
  LIVE_END = 0x85,
  STROKE_ACK = 0x86,
  STROKE_REJECT = 0x87,
  STROKES_HIDDEN = 0x88,
  TILE_FROZEN = 0x89,
  INK = 0x8a,
  NOTICE = 0x8b,
  PONG = 0x8f,
}

export interface TileSubscription {
  tileX: number;
  tileY: number;
  sinceStrokeId: number;
  live: boolean;
}

export interface WsWelcomePayload {
  userId: string;
  inkBurst: number;
  inkBalance: number;
  serverTime: number;
  readOnly: boolean;
}

export interface StrokeCommitMessage {
  clientStrokeId: number;
  strokeBytes: Uint8Array;
}
