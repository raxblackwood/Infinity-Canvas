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
  undoLastStroke(userId: string, windowMs: number): Promise<{ id: number; tileX: number; tileY: number } | null>;

  // Bake job queue (SPEC Section 6 & 9)
  enqueueBakeJob(kind: string, tileX: number, tileY: number, level?: number, runAfter?: Date): Promise<number>;
  claimBakeJob(): Promise<BakeJobRecord | null>;
  completeBakeJob(jobId: number): Promise<void>;
  failBakeJob(jobId: number, retryInMs?: number): Promise<void>;

  // Raster tiles (SPEC Section 6)
  saveRasterTile(level: number, x: number, y: number, version: number, key: string): Promise<void>;
  getRasterTile(level: number, x: number, y: number): Promise<{ version: number; key: string } | null>;

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

  async undoLastStroke(userId: string, windowMs: number): Promise<{ id: number; tileX: number; tileY: number } | null> {
    const cutoff = Date.now() - windowMs;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (s.userId === userId && s.status === 0 && s.createdAt.getTime() >= cutoff) {
        s.status = 3; // undone by author
        const tile = await this.getTile(s.tileX, s.tileY);
        tile.strokeCount = Math.max(0, tile.strokeCount - 1);
        tile.dirtySince = new Date();
        return { id: s.id, tileX: s.tileX, tileY: s.tileY };
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

  async undoLastStroke(userId: string, windowMs: number): Promise<{ id: number; tileX: number; tileY: number } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cutoff = new Date(Date.now() - windowMs);

      const findRes = await client.query(
        `SELECT id, tile_x, tile_y FROM strokes
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

      await client.query(`UPDATE strokes SET status = 3 WHERE id = $1`, [strokeId]);
      await client.query(
        `UPDATE tiles SET stroke_count = GREATEST(0, stroke_count - 1), dirty_since = NOW()
         WHERE tile_x = $1 AND tile_y = $2`,
        [tileX, tileY]
      );

      await client.query('COMMIT');
      return { id: strokeId, tileX, tileY };
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
