import pg from 'pg';
import crypto from 'crypto';
import { TILE_STROKE_CAP } from '@infinite-canvas/shared';

export interface UserRecord {
  id: string; // uuid
  tokenHash: Buffer;
  createdAt: Date;
  lastSeenAt: Date;
  trust: number;
  banned: boolean;
  rulesVersion: number;
}

export interface TileRecord {
  tileX: number;
  tileY: number;
  strokeCount: number;
  frozen: boolean;
  snapshotVersion: number;
  snapshotKey: string | null;
  maxStrokeId: number;
  dirtySince: Date | null;
}

export interface StrokeRecord {
  id: number;
  tileX: number;
  tileY: number;
  userId: string;
  createdAt: Date;
  status: number; // 0 visible, 1 hidden by mod, 2 quarantined, 3 undone
  data: Uint8Array;
}

export interface BakeJobRecord {
  id: number;
  kind: string; // 'snapshot' | 'raster_level_0' | 'raster_parent'
  tileX: number;
  tileY: number;
  level: number;
  runAfter: Date;
  attempts: number;
  lockedAt: Date | null;
}

export interface ReportRecord {
  id: number;
  tileX: number;
  tileY: number;
  pointX: number;
  pointY: number;
  userId: string;
  createdAt: Date;
  reason: string;
  note?: string;
  status: number; // 0 open, 1 actioned, 2 dismissed
}

export interface ReviewItemRecord {
  id: number;
  tileX: number;
  tileY: number;
  flaggedReason: string;
  strokeCount: number;
  priority: number;
  status: number; // 0 pending, 1 resolved
  createdAt: Date;
}

export interface ModActionRecord {
  id: number;
  createdAt: Date;
  adminUser: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  metadata?: any;
}

export interface Storage {
  findOrCreateUser(tokenHash: Buffer): Promise<UserRecord>;
  getUserByTokenHash(tokenHash: Buffer): Promise<UserRecord | null>;
  getTile(tileX: number, tileY: number): Promise<TileRecord>;
  getTileIndex(tiles: { tileX: number; tileY: number }[]): Promise<TileRecord[]>;
  saveStroke(
    tileX: number,
    tileY: number,
    userId: string,
    data: Uint8Array
  ): Promise<{ id: number; strokeCount: number; frozen: boolean }>;
  getStrokesSince(tileX: number, tileY: number, sinceStrokeId: number): Promise<{ id: number; data: Uint8Array }[]>;
  getVisibleStrokesForTile(tileX: number, tileY: number): Promise<{ id: number; data: Uint8Array }[]>;
  updateTileSnapshot(tileX: number, tileY: number, version: number, key: string, maxStrokeId: number): Promise<void>;
  undoLastStroke(userId: string, windowMs: number): Promise<{ id: number; tileX: number; tileY: number; data: Uint8Array } | null>;

  // Bake job queue (SPEC Section 6 & 9)
  enqueueBakeJob(kind: string, tileX: number, tileY: number, level?: number, runAfter?: Date): Promise<number>;
  claimBakeJob(): Promise<BakeJobRecord | null>;
  completeBakeJob(jobId: number): Promise<void>;
  failBakeJob(jobId: number, retryInMs?: number): Promise<void>;

  // Raster tiles (SPEC Section 6)
  saveRasterTile(level: number, x: number, y: number, version: number, key: string): Promise<void>;
  getRasterTile(level: number, x: number, y: number): Promise<{ version: number; key: string } | null>;

  // Moderation & Admin (SPEC Section 10)
  createReport(
    tileX: number,
    tileY: number,
    pointX: number,
    pointY: number,
    userId: string,
    reason: string,
    note?: string
  ): Promise<{ report: ReportRecord; autoQuarantined: boolean; affectedTile?: { tileX: number; tileY: number }; quarantinedIds?: number[] }>;
  quarantineStrokesForTile(tileX: number, tileY: number, sinceTime?: Date): Promise<number[]>;
  restoreStrokes(strokeIds: number[]): Promise<{ tileX: number; tileY: number; strokes: { id: number; data: Uint8Array }[] }[]>;
  hideStrokes(strokeIds: number[]): Promise<{ tileX: number; tileY: number; strokeIds: number[] }[]>;
  bulkHide(options: {
    userId?: string;
    tileX?: number;
    tileY?: number;
    minTx?: number;
    minTy?: number;
    maxTx?: number;
    maxTy?: number;
    since?: Date;
    until?: Date;
  }): Promise<{ affectedTiles: { tileX: number; tileY: number }[]; strokeIds: number[] }>;
  setUserBan(userId: string, banned: boolean): Promise<void>;
  logModAction(adminUser: string, action: string, targetType: string, targetId: string, reason?: string, metadata?: any): Promise<number>;
  getModActions(limit?: number): Promise<ModActionRecord[]>;
  getReviewQueue(status?: number): Promise<ReviewItemRecord[]>;
  resolveReviewItem(id: number): Promise<void>;
  enqueueReviewItem(tileX: number, tileY: number, flaggedReason: string, strokeCount: number, priority?: number): Promise<number>;
  // Discovery & Activity (SPEC Section 7 & Phase 5)
  getRecentActivity(sinceTime?: Date, limit?: number): Promise<{ tileX: number; tileY: number; strokeCount: number; activeUsers: number }[]>;
  getSpawnLocation(): Promise<{ tileX: number; tileY: number; offsetX: number; offsetY: number; scale: number }>;
  updateUserRulesVersion(userId: string, rulesVersion: number): Promise<void>;

  close(): Promise<void>;
}

/**
 * High-performance in-memory storage implementation for zero-dependency local dev and testing.
 */
export class InMemoryStorage implements Storage {
  private users: Map<string, UserRecord> = new Map(); // id -> user
  private tokenHashIndex: Map<string, string> = new Map(); // hex -> id
  private tiles: Map<string, TileRecord> = new Map(); // "tx,ty" -> tile
  private strokes: StrokeRecord[] = [];
  private nextStrokeId = 1;
  private bakeJobs: BakeJobRecord[] = [];
  private nextBakeJobId = 1;
  private rasterTiles: Map<string, { version: number; key: string }> = new Map(); // "level,x,y" -> data
  private reports: ReportRecord[] = [];
  private nextReportId = 1;
  private reviewQueue: ReviewItemRecord[] = [];
  private nextReviewId = 1;
  private modActions: ModActionRecord[] = [];
  private nextModActionId = 1;

  async findOrCreateUser(tokenHash: Buffer): Promise<UserRecord> {
    const key = tokenHash.toString('hex');
    const existingId = this.tokenHashIndex.get(key);
    if (existingId) {
      const user = this.users.get(existingId)!;
      user.lastSeenAt = new Date();
      return user;
    }

    const newUser: UserRecord = {
      id: crypto.randomUUID(),
      tokenHash,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      trust: 0,
      banned: false,
      rulesVersion: 0,
    };

    this.users.set(newUser.id, newUser);
    this.tokenHashIndex.set(key, newUser.id);
    return newUser;
  }

  async getUserByTokenHash(tokenHash: Buffer): Promise<UserRecord | null> {
    const key = tokenHash.toString('hex');
    const id = this.tokenHashIndex.get(key);
    if (!id) return null;
    return this.users.get(id) || null;
  }

  async getTile(tileX: number, tileY: number): Promise<TileRecord> {
    const key = `${tileX},${tileY}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = {
        tileX,
        tileY,
        strokeCount: 0,
        frozen: false,
        snapshotVersion: 0,
        snapshotKey: null,
        maxStrokeId: 0,
        dirtySince: null,
      };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  async getTileIndex(tiles: { tileX: number; tileY: number }[]): Promise<TileRecord[]> {
    const results: TileRecord[] = [];
    for (const t of tiles) {
      results.push(await this.getTile(t.tileX, t.tileY));
    }
    return results;
  }

  async saveStroke(
    tileX: number,
    tileY: number,
    userId: string,
    data: Uint8Array
  ): Promise<{ id: number; strokeCount: number; frozen: boolean }> {
    const tile = await this.getTile(tileX, tileY);
    if (tile.frozen) {
      throw new Error('Tile is frozen');
    }

    const strokeId = this.nextStrokeId++;
    const now = new Date();

    const record: StrokeRecord = {
      id: strokeId,
      tileX,
      tileY,
      userId,
      createdAt: now,
      status: 0, // visible
      data,
    };
    this.strokes.push(record);

    tile.strokeCount++;
    tile.maxStrokeId = strokeId;
    tile.dirtySince = now;

    if (tile.strokeCount >= TILE_STROKE_CAP) {
      tile.frozen = true;
    }

    // Enqueue snapshot bake job (debounced by 5s, SPEC Section 9)
    await this.enqueueBakeJob('snapshot', tileX, tileY, 0, new Date(now.getTime() + 5000));

    return { id: strokeId, strokeCount: tile.strokeCount, frozen: tile.frozen };
  }

  async getStrokesSince(tileX: number, tileY: number, sinceStrokeId: number): Promise<{ id: number; data: Uint8Array }[]> {
    const results: { id: number; data: Uint8Array }[] = [];
    for (const s of this.strokes) {
      if (s.tileX === tileX && s.tileY === tileY && s.id > sinceStrokeId && s.status === 0) {
        results.push({ id: s.id, data: s.data });
      }
    }
    return results;
  }

  async getVisibleStrokesForTile(tileX: number, tileY: number): Promise<{ id: number; data: Uint8Array }[]> {
    const results: { id: number; data: Uint8Array }[] = [];
    for (const s of this.strokes) {
      if (s.tileX === tileX && s.tileY === tileY && s.status === 0) {
        results.push({ id: s.id, data: s.data });
      }
    }
    return results.sort((a, b) => a.id - b.id);
  }

  async updateTileSnapshot(
    tileX: number,
    tileY: number,
    version: number,
    key: string,
    maxStrokeId: number
  ): Promise<void> {
    const tile = await this.getTile(tileX, tileY);
    tile.snapshotVersion = version;
    tile.snapshotKey = key;
    tile.maxStrokeId = maxStrokeId;
    tile.dirtySince = null;
  }

  async undoLastStroke(userId: string, windowMs: number): Promise<{ id: number; tileX: number; tileY: number; data: Uint8Array } | null> {
    const cutoff = Date.now() - windowMs;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (s.userId === userId && s.status === 0 && s.createdAt.getTime() >= cutoff) {
        s.status = 3; // undone by author
        const tile = await this.getTile(s.tileX, s.tileY);
        tile.strokeCount = Math.max(0, tile.strokeCount - 1);
        tile.dirtySince = new Date();
        return { id: s.id, tileX: s.tileX, tileY: s.tileY, data: s.data };
      }
    }
    return null;
  }

  async enqueueBakeJob(
    kind: string,
    tileX: number,
    tileY: number,
    level = 0,
    runAfter: Date = new Date()
  ): Promise<number> {
    // If an unlocked pending job of the same kind, tile, and level exists, update its runAfter
    const existing = this.bakeJobs.find(
      (j) => j.kind === kind && j.tileX === tileX && j.tileY === tileY && j.level === level && !j.lockedAt
    );
    if (existing) {
      existing.runAfter = runAfter;
      return existing.id;
    }

    const id = this.nextBakeJobId++;
    this.bakeJobs.push({
      id,
      kind,
      tileX,
      tileY,
      level,
      runAfter,
      attempts: 0,
      lockedAt: null,
    });
    return id;
  }

  async claimBakeJob(): Promise<BakeJobRecord | null> {
    const now = new Date();
    const candidate = this.bakeJobs
      .filter((j) => !j.lockedAt && j.runAfter <= now && j.attempts < 5)
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];

    if (!candidate) return null;
    candidate.lockedAt = now;
    candidate.attempts++;
    return { ...candidate };
  }

  async completeBakeJob(jobId: number): Promise<void> {
    const idx = this.bakeJobs.findIndex((j) => j.id === jobId);
    if (idx !== -1) {
      this.bakeJobs.splice(idx, 1);
    }
  }

  async failBakeJob(jobId: number, retryInMs = 5000): Promise<void> {
    const job = this.bakeJobs.find((j) => j.id === jobId);
    if (job) {
      job.lockedAt = null;
      job.runAfter = new Date(Date.now() + retryInMs);
    }
  }

  async saveRasterTile(level: number, x: number, y: number, version: number, key: string): Promise<void> {
    this.rasterTiles.set(`${level},${x},${y}`, { version, key });
  }

  async getRasterTile(level: number, x: number, y: number): Promise<{ version: number; key: string } | null> {
    const item = this.rasterTiles.get(`${level},${x},${y}`);
    return item ? { ...item } : null;
  }

  async createReport(
    tileX: number,
    tileY: number,
    pointX: number,
    pointY: number,
    userId: string,
    reason: string,
    note?: string
  ): Promise<{ report: ReportRecord; autoQuarantined: boolean; affectedTile?: { tileX: number; tileY: number }; quarantinedIds?: number[] }> {
    const report: ReportRecord = {
      id: this.nextReportId++,
      tileX,
      tileY,
      pointX,
      pointY,
      userId,
      createdAt: new Date(),
      reason,
      note,
      status: 0,
    };
    this.reports.push(report);

    // Auto-quarantine check: 3+ distinct reporters on the same tile within 1 hour
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const recentReports = this.reports.filter(
      (r) => r.tileX === tileX && r.tileY === tileY && r.createdAt >= oneHourAgo
    );
    const distinctUsers = new Set(recentReports.map((r) => r.userId));

    let autoQuarantined = false;
    let quarantinedIds: number[] = [];

    if (distinctUsers.size >= 3) {
      autoQuarantined = true;
      quarantinedIds = await this.quarantineStrokesForTile(tileX, tileY, oneHourAgo);
      await this.enqueueReviewItem(
        tileX,
        tileY,
        `Auto-quarantine: ${distinctUsers.size} distinct reports within 1 hour`,
        quarantinedIds.length,
        10
      );
    }

    return {
      report,
      autoQuarantined,
      affectedTile: autoQuarantined ? { tileX, tileY } : undefined,
      quarantinedIds: autoQuarantined ? quarantinedIds : undefined,
    };
  }

  async quarantineStrokesForTile(tileX: number, tileY: number, sinceTime?: Date): Promise<number[]> {
    const quarantined: number[] = [];
    for (const stroke of this.strokes) {
      if (stroke.tileX === tileX && stroke.tileY === tileY && stroke.status === 0) {
        if (!sinceTime || stroke.createdAt >= sinceTime) {
          stroke.status = 2; // 2 = quarantined
          quarantined.push(stroke.id);
        }
      }
    }
    return quarantined;
  }

  async restoreStrokes(strokeIds: number[]): Promise<{ tileX: number; tileY: number; strokes: { id: number; data: Uint8Array }[] }[]> {
    const idSet = new Set(strokeIds);
    const tileMap = new Map<string, { tileX: number; tileY: number; strokes: { id: number; data: Uint8Array }[] }>();

    for (const stroke of this.strokes) {
      if (idSet.has(stroke.id)) {
        stroke.status = 0; // restore to visible
        const key = `${stroke.tileX},${stroke.tileY}`;
        let entry = tileMap.get(key);
        if (!entry) {
          entry = { tileX: stroke.tileX, tileY: stroke.tileY, strokes: [] };
          tileMap.set(key, entry);
        }
        entry.strokes.push({ id: stroke.id, data: stroke.data });
      }
    }

    return Array.from(tileMap.values());
  }

  async hideStrokes(strokeIds: number[]): Promise<{ tileX: number; tileY: number; strokeIds: number[] }[]> {
    const idSet = new Set(strokeIds);
    const tileMap = new Map<string, { tileX: number; tileY: number; strokeIds: number[] }>();

    for (const stroke of this.strokes) {
      if (idSet.has(stroke.id)) {
        stroke.status = 1; // 1 = hidden
        const key = `${stroke.tileX},${stroke.tileY}`;
        let entry = tileMap.get(key);
        if (!entry) {
          entry = { tileX: stroke.tileX, tileY: stroke.tileY, strokeIds: [] };
          tileMap.set(key, entry);
        }
        entry.strokeIds.push(stroke.id);
      }
    }

    return Array.from(tileMap.values());
  }

  async bulkHide(options: {
    userId?: string;
    tileX?: number;
    tileY?: number;
    minTx?: number;
    minTy?: number;
    maxTx?: number;
    maxTy?: number;
    since?: Date;
    until?: Date;
  }): Promise<{ affectedTiles: { tileX: number; tileY: number }[]; strokeIds: number[] }> {
    const affectedTilesMap = new Map<string, { tileX: number; tileY: number }>();
    const hiddenStrokeIds: number[] = [];

    for (const stroke of this.strokes) {
      if (stroke.status !== 0 && stroke.status !== 2) continue; // only hide active/quarantined

      if (options.userId && stroke.userId !== options.userId) continue;
      if (options.tileX !== undefined && stroke.tileX !== options.tileX) continue;
      if (options.tileY !== undefined && stroke.tileY !== options.tileY) continue;
      if (options.minTx !== undefined && stroke.tileX < options.minTx) continue;
      if (options.maxTx !== undefined && stroke.tileX > options.maxTx) continue;
      if (options.minTy !== undefined && stroke.tileY < options.minTy) continue;
      if (options.maxTy !== undefined && stroke.tileY > options.maxTy) continue;
      if (options.since && stroke.createdAt < options.since) continue;
      if (options.until && stroke.createdAt > options.until) continue;

      stroke.status = 1; // hidden
      hiddenStrokeIds.push(stroke.id);
      const key = `${stroke.tileX},${stroke.tileY}`;
      if (!affectedTilesMap.has(key)) {
        affectedTilesMap.set(key, { tileX: stroke.tileX, tileY: stroke.tileY });
      }
    }

    return {
      affectedTiles: Array.from(affectedTilesMap.values()),
      strokeIds: hiddenStrokeIds,
    };
  }

  async setUserBan(userId: string, banned: boolean): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.banned = banned;
    }
  }

  async logModAction(
    adminUser: string,
    action: string,
    targetType: string,
    targetId: string,
    reason?: string,
    metadata?: any
  ): Promise<number> {
    const id = this.nextModActionId++;
    this.modActions.push({
      id,
      createdAt: new Date(),
      adminUser,
      action,
      targetType,
      targetId,
      reason,
      metadata,
    });
    return id;
  }

  async getModActions(limit = 100): Promise<ModActionRecord[]> {
    return [...this.modActions]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getReviewQueue(status?: number): Promise<ReviewItemRecord[]> {
    return this.reviewQueue
      .filter((item) => (status !== undefined ? item.status === status : true))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  async resolveReviewItem(id: number): Promise<void> {
    const item = this.reviewQueue.find((q) => q.id === id);
    if (item) {
      item.status = 1; // resolved
    }
  }

  async enqueueReviewItem(
    tileX: number,
    tileY: number,
    flaggedReason: string,
    strokeCount: number,
    priority = 0
  ): Promise<number> {
    const id = this.nextReviewId++;
    this.reviewQueue.push({
      id,
      tileX,
      tileY,
      flaggedReason,
      strokeCount,
      priority,
      status: 0,
      createdAt: new Date(),
    });
    return id;
  }

  async getStats(): Promise<{
    strokesPerMinute: number;
    activeUsers: number;
    openReports: number;
    reviewQueueDepth: number;
  }> {
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    const fiveMinAgo = new Date(Date.now() - 300 * 1000);

    const strokesPerMinute = this.strokes.filter((s) => s.createdAt >= oneMinAgo).length;
    const activeUsers = Array.from(this.users.values()).filter((u) => u.lastSeenAt >= fiveMinAgo).length;
    const openReports = this.reports.filter((r) => r.status === 0).length;
    const reviewQueueDepth = this.reviewQueue.filter((q) => q.status === 0).length;

    return {
      strokesPerMinute,
      activeUsers,
      openReports,
      reviewQueueDepth,
    };
  }

  async getRecentActivity(
    sinceTime: Date = new Date(Date.now() - 3600 * 1000),
    limit = 50
  ): Promise<{ tileX: number; tileY: number; strokeCount: number; activeUsers: number }[]> {
    let candidateStrokes = this.strokes.filter(
      (s) => s.status === 0 && s.createdAt >= sinceTime
    );

    // If no strokes within sinceTime, fallback to all visible strokes so canvas is not empty
    if (candidateStrokes.length === 0) {
      candidateStrokes = this.strokes.filter((s) => s.status === 0);
    }

    const tileMap = new Map<string, { tileX: number; tileY: number; strokeCount: number; users: Set<string> }>();
    for (const s of candidateStrokes) {
      const key = `${s.tileX},${s.tileY}`;
      let entry = tileMap.get(key);
      if (!entry) {
        entry = { tileX: s.tileX, tileY: s.tileY, strokeCount: 0, users: new Set() };
        tileMap.set(key, entry);
      }
      entry.strokeCount++;
      entry.users.add(s.userId);
    }

    const results = Array.from(tileMap.values())
      .map((e) => ({
        tileX: e.tileX,
        tileY: e.tileY,
        strokeCount: e.strokeCount,
        activeUsers: e.users.size,
      }))
      .sort((a, b) => b.strokeCount - a.strokeCount)
      .slice(0, limit);

    return results;
  }

  async getSpawnLocation(): Promise<{ tileX: number; tileY: number; offsetX: number; offsetY: number; scale: number }> {
    const activity = await this.getRecentActivity(new Date(Date.now() - 3600 * 1000), 1);
    if (activity.length > 0) {
      return {
        tileX: activity[0].tileX,
        tileY: activity[0].tileY,
        offsetX: 0.5,
        offsetY: 0.5,
        scale: 2048,
      };
    }
    return {
      tileX: 0,
      tileY: 0,
      offsetX: 0.5,
      offsetY: 0.5,
      scale: 2048,
    };
  }

  async updateUserRulesVersion(userId: string, rulesVersion: number): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.rulesVersion = rulesVersion;
    }
  }

  async close(): Promise<void> {}
}

/**
 * PostgreSQL storage implementation using pg.Pool.
 */
export class PostgresStorage implements Storage {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async initSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          token_hash BYTEA UNIQUE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          last_seen_at TIMESTAMPTZ NOT NULL,
          trust INT DEFAULT 0,
          banned BOOL DEFAULT false,
          rules_version INT DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tiles (
          tile_x INT NOT NULL,
          tile_y INT NOT NULL,
          stroke_count INT DEFAULT 0,
          frozen BOOL DEFAULT false,
          snapshot_version INT DEFAULT 0,
          snapshot_key TEXT,
          max_stroke_id BIGINT DEFAULT 0,
          dirty_since TIMESTAMPTZ,
          PRIMARY KEY (tile_x, tile_y)
        );

        CREATE TABLE IF NOT EXISTS strokes (
          id BIGSERIAL PRIMARY KEY,
          tile_x INT NOT NULL,
          tile_y INT NOT NULL,
          user_id UUID NOT NULL REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL,
          status SMALLINT DEFAULT 0,
          data BYTEA NOT NULL
        );

        CREATE TABLE IF NOT EXISTS raster_tiles (
          level SMALLINT NOT NULL,
          x INT NOT NULL,
          y INT NOT NULL,
          version INT NOT NULL DEFAULT 1,
          key TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (level, x, y)
        );

        CREATE TABLE IF NOT EXISTS bake_jobs (
          id BIGSERIAL PRIMARY KEY,
          kind TEXT NOT NULL,
          tile_x INT NOT NULL,
          tile_y INT NOT NULL,
          level SMALLINT DEFAULT 0,
          run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          attempts INT NOT NULL DEFAULT 0,
          locked_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_strokes_tile_id ON strokes (tile_x, tile_y, id);
        CREATE INDEX IF NOT EXISTS idx_strokes_user_created ON strokes (user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_bake_jobs_claim ON bake_jobs (run_after, attempts) WHERE locked_at IS NULL;

        CREATE TABLE IF NOT EXISTS reports (
          id BIGSERIAL PRIMARY KEY,
          tile_x INT NOT NULL,
          tile_y INT NOT NULL,
          point_x INT NOT NULL DEFAULT 32768,
          point_y INT NOT NULL DEFAULT 32768,
          user_id UUID NOT NULL REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          reason TEXT NOT NULL,
          note TEXT,
          status SMALLINT NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_reports_tile_created ON reports (tile_x, tile_y, created_at);
        CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id);

        CREATE TABLE IF NOT EXISTS review_queue (
          id BIGSERIAL PRIMARY KEY,
          tile_x INT NOT NULL,
          tile_y INT NOT NULL,
          flagged_reason TEXT NOT NULL,
          stroke_count INT NOT NULL DEFAULT 0,
          priority INT NOT NULL DEFAULT 0,
          status SMALLINT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_review_queue_pending ON review_queue (status, priority DESC, created_at ASC);

        CREATE TABLE IF NOT EXISTS mod_actions (
          id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          admin_user TEXT NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          reason TEXT,
          metadata JSONB
        );

        CREATE INDEX IF NOT EXISTS idx_mod_actions_created ON mod_actions (created_at DESC);
      `);
    } finally {
      client.release();
    }
  }

  async findOrCreateUser(tokenHash: Buffer): Promise<UserRecord> {
    const existing = await this.getUserByTokenHash(tokenHash);
    if (existing) {
      await this.pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [existing.id]);
      return existing;
    }

    const id = crypto.randomUUID();
    const res = await this.pool.query(
      `INSERT INTO users (id, token_hash, created_at, last_seen_at, trust, banned, rules_version)
       VALUES ($1, $2, NOW(), NOW(), 0, false, 0)
       RETURNING id, token_hash, created_at, last_seen_at, trust, banned, rules_version`,
      [id, tokenHash]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      trust: row.trust,
      banned: row.banned,
      rulesVersion: row.rules_version,
    };
  }

  async getUserByTokenHash(tokenHash: Buffer): Promise<UserRecord | null> {
    const res = await this.pool.query(
      `SELECT id, token_hash, created_at, last_seen_at, trust, banned, rules_version
       FROM users WHERE token_hash = $1`,
      [tokenHash]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      trust: row.trust,
      banned: row.banned,
      rulesVersion: row.rules_version,
    };
  }

  async getTile(tileX: number, tileY: number): Promise<TileRecord> {
    const res = await this.pool.query(
      `INSERT INTO tiles (tile_x, tile_y)
       VALUES ($1, $2)
       ON CONFLICT (tile_x, tile_y) DO NOTHING;
       SELECT tile_x, tile_y, stroke_count, frozen, snapshot_version, snapshot_key, max_stroke_id, dirty_since
       FROM tiles WHERE tile_x = $1 AND tile_y = $2`,
      [tileX, tileY]
    );
    const row = res.rows[res.rows.length - 1];
    return {
      tileX: row.tile_x,
      tileY: row.tile_y,
      strokeCount: row.stroke_count,
      frozen: row.frozen,
      snapshotVersion: row.snapshot_version,
      snapshotKey: row.snapshot_key,
      maxStrokeId: Number(row.max_stroke_id),
      dirtySince: row.dirty_since,
    };
  }

  async getTileIndex(tiles: { tileX: number; tileY: number }[]): Promise<TileRecord[]> {
    if (tiles.length === 0) return [];
    const values: any[] = [];
    const clauses: string[] = [];

    tiles.forEach((t, i) => {
      values.push(t.tileX, t.tileY);
      clauses.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
    });

    const res = await this.pool.query(
      `SELECT tile_x, tile_y, stroke_count, frozen, snapshot_version, snapshot_key, max_stroke_id, dirty_since
       FROM tiles
       WHERE (tile_x, tile_y) IN (${clauses.join(', ')})`,
      values
    );

    const map = new Map<string, TileRecord>();
    for (const row of res.rows) {
      map.set(`${row.tile_x},${row.tile_y}`, {
        tileX: row.tile_x,
        tileY: row.tile_y,
        strokeCount: row.stroke_count,
        frozen: row.frozen,
        snapshotVersion: row.snapshot_version,
        snapshotKey: row.snapshot_key,
        maxStrokeId: Number(row.max_stroke_id),
        dirtySince: row.dirty_since,
      });
    }

    // Return records in order, with empty defaults for any tile not yet stored
    return tiles.map((t) => {
      const existing = map.get(`${t.tileX},${t.tileY}`);
      if (existing) return existing;
      return {
        tileX: t.tileX,
        tileY: t.tileY,
        strokeCount: 0,
        frozen: false,
        snapshotVersion: 0,
        snapshotKey: null,
        maxStrokeId: 0,
        dirtySince: null,
      };
    });
  }

  async saveStroke(
    tileX: number,
    tileY: number,
    userId: string,
    data: Uint8Array
  ): Promise<{ id: number; strokeCount: number; frozen: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check tile status
      const tileRes = await client.query(
        `SELECT frozen, stroke_count FROM tiles WHERE tile_x = $1 AND tile_y = $2 FOR UPDATE`,
        [tileX, tileY]
      );
      if (tileRes.rows.length > 0 && tileRes.rows[0].frozen) {
        throw new Error('Tile is frozen');
      }

      // Insert stroke
      const strokeRes = await client.query(
        `INSERT INTO strokes (tile_x, tile_y, user_id, created_at, status, data)
         VALUES ($1, $2, $3, NOW(), 0, $4)
         RETURNING id`,
        [tileX, tileY, userId, Buffer.from(data)]
      );
      const strokeId = Number(strokeRes.rows[0].id);

      // Update tile
      const updateRes = await client.query(
        `INSERT INTO tiles (tile_x, tile_y, stroke_count, max_stroke_id, dirty_since, frozen)
         VALUES ($1, $2, 1, $3, NOW(), false)
         ON CONFLICT (tile_x, tile_y) DO UPDATE
         SET stroke_count = tiles.stroke_count + 1,
             max_stroke_id = $3,
             dirty_since = NOW(),
             frozen = (tiles.stroke_count + 1 >= ${TILE_STROKE_CAP})
         RETURNING stroke_count, frozen`,
        [tileX, tileY, strokeId]
      );

      // Enqueue bake job (SPEC Section 9)
      await client.query(
        `INSERT INTO bake_jobs (kind, tile_x, tile_y, level, run_after)
         VALUES ('snapshot', $1, $2, 0, NOW() + INTERVAL '5 seconds')`,
        [tileX, tileY]
      );

      await client.query('COMMIT');
      return {
        id: strokeId,
        strokeCount: updateRes.rows[0].stroke_count,
        frozen: updateRes.rows[0].frozen,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getStrokesSince(tileX: number, tileY: number, sinceStrokeId: number): Promise<{ id: number; data: Uint8Array }[]> {
    const res = await this.pool.query(
      `SELECT id, data FROM strokes
       WHERE tile_x = $1 AND tile_y = $2 AND id > $3 AND status = 0
       ORDER BY id ASC`,
      [tileX, tileY, sinceStrokeId]
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      data: new Uint8Array(r.data),
    }));
  }

  async getVisibleStrokesForTile(tileX: number, tileY: number): Promise<{ id: number; data: Uint8Array }[]> {
    const res = await this.pool.query(
      `SELECT id, data FROM strokes
       WHERE tile_x = $1 AND tile_y = $2 AND status = 0
       ORDER BY id ASC`,
      [tileX, tileY]
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      data: new Uint8Array(r.data),
    }));
  }

  async updateTileSnapshot(
    tileX: number,
    tileY: number,
    version: number,
    key: string,
    maxStrokeId: number
  ): Promise<void> {
    await this.pool.query(
      `UPDATE tiles
       SET snapshot_version = $1, snapshot_key = $2, max_stroke_id = $3, dirty_since = NULL
       WHERE tile_x = $4 AND tile_y = $5`,
      [version, key, maxStrokeId, tileX, tileY]
    );
  }

  async undoLastStroke(userId: string, windowMs: number): Promise<{ id: number; tileX: number; tileY: number; data: Uint8Array } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cutoff = new Date(Date.now() - windowMs);

      const findRes = await client.query(
        `SELECT id, tile_x, tile_y, data FROM strokes
         WHERE user_id = $1 AND status = 0 AND created_at >= $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [userId, cutoff]
      );
      if (findRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const row = findRes.rows[0];
      const strokeId = Number(row.id);
      const tileX = row.tile_x;
      const tileY = row.tile_y;
      const data = new Uint8Array(row.data);

      await client.query(`UPDATE strokes SET status = 3 WHERE id = $1`, [strokeId]);
      await client.query(
        `UPDATE tiles SET stroke_count = GREATEST(0, stroke_count - 1), dirty_since = NOW()
         WHERE tile_x = $1 AND tile_y = $2`,
        [tileX, tileY]
      );

      await client.query('COMMIT');
      return { id: strokeId, tileX, tileY, data };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async enqueueBakeJob(
    kind: string,
    tileX: number,
    tileY: number,
    level = 0,
    runAfter: Date = new Date()
  ): Promise<number> {
    const res = await this.pool.query(
      `INSERT INTO bake_jobs (kind, tile_x, tile_y, level, run_after)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [kind, tileX, tileY, level, runAfter]
    );
    return Number(res.rows[0].id);
  }

  async claimBakeJob(): Promise<BakeJobRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claimRes = await client.query(
        `UPDATE bake_jobs
         SET locked_at = NOW(), attempts = attempts + 1
         WHERE id = (
           SELECT id FROM bake_jobs
           WHERE run_after <= NOW() AND locked_at IS NULL AND attempts < 5
           ORDER BY run_after ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, kind, tile_x, tile_y, level, run_after, attempts, locked_at`
      );
      await client.query('COMMIT');
      if (claimRes.rows.length === 0) return null;
      const r = claimRes.rows[0];
      return {
        id: Number(r.id),
        kind: r.kind,
        tileX: r.tile_x,
        tileY: r.tile_y,
        level: r.level,
        runAfter: r.run_after,
        attempts: r.attempts,
        lockedAt: r.locked_at,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async completeBakeJob(jobId: number): Promise<void> {
    await this.pool.query('DELETE FROM bake_jobs WHERE id = $1', [jobId]);
  }

  async failBakeJob(jobId: number, retryInMs = 5000): Promise<void> {
    await this.pool.query(
      `UPDATE bake_jobs
       SET locked_at = NULL, run_after = NOW() + ($2 || ' milliseconds')::interval
       WHERE id = $1`,
      [jobId, retryInMs]
    );
  }

  async saveRasterTile(level: number, x: number, y: number, version: number, key: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO raster_tiles (level, x, y, version, key, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (level, x, y) DO UPDATE
       SET version = $4, key = $5, created_at = NOW()`,
      [level, x, y, version, key]
    );
  }

  async getRasterTile(level: number, x: number, y: number): Promise<{ version: number; key: string } | null> {
    const res = await this.pool.query(
      `SELECT version, key FROM raster_tiles WHERE level = $1 AND x = $2 AND y = $3`,
      [level, x, y]
    );
    if (res.rows.length === 0) return null;
    return {
      version: res.rows[0].version,
      key: res.rows[0].key,
    };
  }

  async createReport(
    tileX: number,
    tileY: number,
    pointX: number,
    pointY: number,
    userId: string,
    reason: string,
    note?: string
  ): Promise<{ report: ReportRecord; autoQuarantined: boolean; affectedTile?: { tileX: number; tileY: number }; quarantinedIds?: number[] }> {
    const res = await this.pool.query(
      `INSERT INTO reports (tile_x, tile_y, point_x, point_y, user_id, reason, note, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NOW())
       RETURNING id, tile_x, tile_y, point_x, point_y, user_id, reason, note, status, created_at`,
      [tileX, tileY, pointX, pointY, userId, reason, note || null]
    );
    const r = res.rows[0];
    const report: ReportRecord = {
      id: Number(r.id),
      tileX: r.tile_x,
      tileY: r.tile_y,
      pointX: r.point_x,
      pointY: r.point_y,
      userId: r.user_id,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.created_at,
    };

    // Auto-quarantine check: 3+ distinct reporters in same tile within 1 hour
    const checkRes = await this.pool.query(
      `SELECT COUNT(DISTINCT user_id) as reporter_count
       FROM reports
       WHERE tile_x = $1 AND tile_y = $2 AND created_at >= NOW() - INTERVAL '1 hour'`,
      [tileX, tileY]
    );
    const count = parseInt(checkRes.rows[0].reporter_count, 10);
    let autoQuarantined = false;
    let quarantinedIds: number[] = [];

    if (count >= 3) {
      autoQuarantined = true;
      const oneHourAgo = new Date(Date.now() - 3600 * 1000);
      quarantinedIds = await this.quarantineStrokesForTile(tileX, tileY, oneHourAgo);
      await this.enqueueReviewItem(
        tileX,
        tileY,
        `Auto-quarantine: ${count} distinct reports within 1 hour`,
        quarantinedIds.length,
        10
      );
    }

    return {
      report,
      autoQuarantined,
      affectedTile: autoQuarantined ? { tileX, tileY } : undefined,
      quarantinedIds: autoQuarantined ? quarantinedIds : undefined,
    };
  }

  async quarantineStrokesForTile(tileX: number, tileY: number, sinceTime?: Date): Promise<number[]> {
    const res = await this.pool.query(
      `UPDATE strokes
       SET status = 2
       WHERE tile_x = $1 AND tile_y = $2 AND status = 0 AND ($3::TIMESTAMPTZ IS NULL OR created_at >= $3)
       RETURNING id`,
      [tileX, tileY, sinceTime || null]
    );
    return res.rows.map((row) => Number(row.id));
  }

  async restoreStrokes(strokeIds: number[]): Promise<{ tileX: number; tileY: number; strokes: { id: number; data: Uint8Array }[] }[]> {
    if (strokeIds.length === 0) return [];
    const res = await this.pool.query(
      `UPDATE strokes
       SET status = 0
       WHERE id = ANY($1::bigint[])
       RETURNING id, tile_x, tile_y, data`,
      [strokeIds]
    );

    const tileMap = new Map<string, { tileX: number; tileY: number; strokes: { id: number; data: Uint8Array }[] }>();
    for (const r of res.rows) {
      const key = `${r.tile_x},${r.tile_y}`;
      let entry = tileMap.get(key);
      if (!entry) {
        entry = { tileX: r.tile_x, tileY: r.tile_y, strokes: [] };
        tileMap.set(key, entry);
      }
      entry.strokes.push({ id: Number(r.id), data: r.data });
    }
    return Array.from(tileMap.values());
  }

  async hideStrokes(strokeIds: number[]): Promise<{ tileX: number; tileY: number; strokeIds: number[] }[]> {
    if (strokeIds.length === 0) return [];
    const res = await this.pool.query(
      `UPDATE strokes
       SET status = 1
       WHERE id = ANY($1::bigint[])
       RETURNING id, tile_x, tile_y`,
      [strokeIds]
    );

    const tileMap = new Map<string, { tileX: number; tileY: number; strokeIds: number[] }>();
    for (const r of res.rows) {
      const key = `${r.tile_x},${r.tile_y}`;
      let entry = tileMap.get(key);
      if (!entry) {
        entry = { tileX: r.tile_x, tileY: r.tile_y, strokeIds: [] };
        tileMap.set(key, entry);
      }
      entry.strokeIds.push(Number(r.id));
    }
    return Array.from(tileMap.values());
  }

  async bulkHide(options: {
    userId?: string;
    tileX?: number;
    tileY?: number;
    minTx?: number;
    minTy?: number;
    maxTx?: number;
    maxTy?: number;
    since?: Date;
    until?: Date;
  }): Promise<{ affectedTiles: { tileX: number; tileY: number }[]; strokeIds: number[] }> {
    const conditions: string[] = ['(status = 0 OR status = 2)'];
    const params: any[] = [];
    let pIdx = 1;

    if (options.userId) {
      conditions.push(`user_id = $${pIdx++}`);
      params.push(options.userId);
    }
    if (options.tileX !== undefined) {
      conditions.push(`tile_x = $${pIdx++}`);
      params.push(options.tileX);
    }
    if (options.tileY !== undefined) {
      conditions.push(`tile_y = $${pIdx++}`);
      params.push(options.tileY);
    }
    if (options.minTx !== undefined) {
      conditions.push(`tile_x >= $${pIdx++}`);
      params.push(options.minTx);
    }
    if (options.maxTx !== undefined) {
      conditions.push(`tile_x <= $${pIdx++}`);
      params.push(options.maxTx);
    }
    if (options.minTy !== undefined) {
      conditions.push(`tile_y >= $${pIdx++}`);
      params.push(options.minTy);
    }
    if (options.maxTy !== undefined) {
      conditions.push(`tile_y <= $${pIdx++}`);
      params.push(options.maxTy);
    }
    if (options.since) {
      conditions.push(`created_at >= $${pIdx++}`);
      params.push(options.since);
    }
    if (options.until) {
      conditions.push(`created_at <= $${pIdx++}`);
      params.push(options.until);
    }

    const sql = `UPDATE strokes SET status = 1 WHERE ${conditions.join(' AND ')} RETURNING id, tile_x, tile_y`;
    const res = await this.pool.query(sql, params);

    const affectedTilesMap = new Map<string, { tileX: number; tileY: number }>();
    const strokeIds: number[] = [];

    for (const r of res.rows) {
      strokeIds.push(Number(r.id));
      const key = `${r.tile_x},${r.tile_y}`;
      if (!affectedTilesMap.has(key)) {
        affectedTilesMap.set(key, { tileX: r.tile_x, tileY: r.tile_y });
      }
    }

    return {
      affectedTiles: Array.from(affectedTilesMap.values()),
      strokeIds,
    };
  }

  async setUserBan(userId: string, banned: boolean): Promise<void> {
    await this.pool.query('UPDATE users SET banned = $2 WHERE id = $1', [userId, banned]);
  }

  async logModAction(
    adminUser: string,
    action: string,
    targetType: string,
    targetId: string,
    reason?: string,
    metadata?: any
  ): Promise<number> {
    const res = await this.pool.query(
      `INSERT INTO mod_actions (created_at, admin_user, action, target_type, target_id, reason, metadata)
       VALUES (NOW(), $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [adminUser, action, targetType, targetId, reason || null, metadata ? JSON.stringify(metadata) : null]
    );
    return Number(res.rows[0].id);
  }

  async getModActions(limit = 100): Promise<ModActionRecord[]> {
    const res = await this.pool.query(
      `SELECT id, created_at, admin_user, action, target_type, target_id, reason, metadata
       FROM mod_actions
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      createdAt: r.created_at,
      adminUser: r.admin_user,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      metadata: r.metadata,
    }));
  }

  async getReviewQueue(status?: number): Promise<ReviewItemRecord[]> {
    const res = await this.pool.query(
      `SELECT id, tile_x, tile_y, flagged_reason, stroke_count, priority, status, created_at
       FROM review_queue
       WHERE ($1::smallint IS NULL OR status = $1)
       ORDER BY priority DESC, created_at ASC`,
      [status !== undefined ? status : null]
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      tileX: r.tile_x,
      tileY: r.tile_y,
      flaggedReason: r.flagged_reason,
      strokeCount: r.stroke_count,
      priority: r.priority,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  async resolveReviewItem(id: number): Promise<void> {
    await this.pool.query('UPDATE review_queue SET status = 1 WHERE id = $1', [id]);
  }

  async enqueueReviewItem(
    tileX: number,
    tileY: number,
    flaggedReason: string,
    strokeCount: number,
    priority = 0
  ): Promise<number> {
    const res = await this.pool.query(
      `INSERT INTO review_queue (tile_x, tile_y, flagged_reason, stroke_count, priority, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 0, NOW())
       RETURNING id`,
      [tileX, tileY, flaggedReason, strokeCount, priority]
    );
    return Number(res.rows[0].id);
  }

  async getStats(): Promise<{
    strokesPerMinute: number;
    activeUsers: number;
    openReports: number;
    reviewQueueDepth: number;
  }> {
    const res = await this.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM strokes WHERE created_at >= NOW() - INTERVAL '1 minute') AS spm,
        (SELECT COUNT(*) FROM users WHERE last_seen_at >= NOW() - INTERVAL '5 minutes') AS active_users,
        (SELECT COUNT(*) FROM reports WHERE status = 0) AS open_reports,
        (SELECT COUNT(*) FROM review_queue WHERE status = 0) AS queue_depth
    `);
    const r = res.rows[0];
    return {
      strokesPerMinute: Number(r.spm || 0),
      activeUsers: Number(r.active_users || 0),
      openReports: Number(r.open_reports || 0),
      reviewQueueDepth: Number(r.queue_depth || 0),
    };
  }

  async getRecentActivity(
    sinceTime: Date = new Date(Date.now() - 3600 * 1000),
    limit = 50
  ): Promise<{ tileX: number; tileY: number; strokeCount: number; activeUsers: number }[]> {
    let res = await this.pool.query(
      `SELECT tile_x as "tileX", tile_y as "tileY", COUNT(*)::int as "strokeCount", COUNT(DISTINCT user_id)::int as "activeUsers"
       FROM strokes
       WHERE status = 0 AND created_at >= $1
       GROUP BY tile_x, tile_y
       ORDER BY "strokeCount" DESC
       LIMIT $2`,
      [sinceTime, limit]
    );

    if (res.rows.length === 0) {
      res = await this.pool.query(
        `SELECT tile_x as "tileX", tile_y as "tileY", COUNT(*)::int as "strokeCount", COUNT(DISTINCT user_id)::int as "activeUsers"
         FROM strokes
         WHERE status = 0
         GROUP BY tile_x, tile_y
         ORDER BY MAX(created_at) DESC
         LIMIT $1`,
        [limit]
      );
    }

    return res.rows.map((r: any) => ({
      tileX: Number(r.tileX),
      tileY: Number(r.tileY),
      strokeCount: Number(r.strokeCount),
      activeUsers: Number(r.activeUsers),
    }));
  }

  async getSpawnLocation(): Promise<{ tileX: number; tileY: number; offsetX: number; offsetY: number; scale: number }> {
    const activity = await this.getRecentActivity(new Date(Date.now() - 3600 * 1000), 1);
    if (activity.length > 0) {
      return {
        tileX: activity[0].tileX,
        tileY: activity[0].tileY,
        offsetX: 0.5,
        offsetY: 0.5,
        scale: 2048,
      };
    }
    return {
      tileX: 0,
      tileY: 0,
      offsetX: 0.5,
      offsetY: 0.5,
      scale: 2048,
    };
  }

  async updateUserRulesVersion(userId: string, rulesVersion: number): Promise<void> {
    await this.pool.query('UPDATE users SET rules_version = $2 WHERE id = $1', [userId, rulesVersion]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Creates storage instance based on environment.
 */
let sharedStorageInstance: Storage | null = null;

export async function createStorage(): Promise<Storage> {
  if (sharedStorageInstance) return sharedStorageInstance;

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const storage = new PostgresStorage(dbUrl);
    await storage.initSchema();
    sharedStorageInstance = storage;
  } else {
    sharedStorageInstance = new InMemoryStorage();
  }
  return sharedStorageInstance;
}

export function setSharedStorage(storage: Storage): void {
  sharedStorageInstance = storage;
}
