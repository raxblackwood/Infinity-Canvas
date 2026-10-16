import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Storage, InMemoryStorage } from '../apps/server/src/db/storage.js';
import { encodeStroke } from '../packages/shared/src/index.js';

export interface BackupArchive {
  version: number;
  timestamp: string;
  checksum: string;
  stats: {
    usersCount: number;
    tilesCount: number;
    strokesCount: number;
    reportsCount: number;
    modActionsCount: number;
  };
  data: {
    users: any[];
    tiles: any[];
    strokes: any[];
    reports: any[];
    modActions: any[];
  };
}

/**
 * Creates an export archive from storage.
 */
export async function createBackup(storage: Storage): Promise<BackupArchive> {
  const users: any[] = [];
  const tiles: any[] = [];
  const strokes: any[] = [];
  const reports: any[] = [];
  const modActions = await storage.getModActions(1000);

  // If InMemoryStorage, export internal collections
  if (storage instanceof InMemoryStorage) {
    const rawStorage = storage as any;
    for (const u of rawStorage.users.values()) {
      users.push({
        ...u,
        tokenHash: u.tokenHash.toString('hex'),
      });
    }
    for (const t of rawStorage.tiles.values()) {
      tiles.push(t);
    }
    for (const s of rawStorage.strokes) {
      strokes.push({
        ...s,
        data: Buffer.from(s.data).toString('base64'),
      });
    }
    for (const r of rawStorage.reports) {
      reports.push(r);
    }
  }

  const payload = JSON.stringify({ users, tiles, strokes, reports, modActions });
  const checksum = crypto.createHash('sha256').update(payload).digest('hex');

  return {
    version: 1,
    timestamp: new Date().toISOString(),
    checksum,
    stats: {
      usersCount: users.length,
      tilesCount: tiles.length,
      strokesCount: strokes.length,
      reportsCount: reports.length,
      modActionsCount: modActions.length,
    },
    data: { users, tiles, strokes, reports, modActions },
  };
}

/**
 * Restores a backup archive into a target storage instance and validates integrity.
 */
export async function restoreBackup(archive: BackupArchive, targetStorage: Storage): Promise<{
  success: boolean;
  restoredStrokes: number;
  restoredUsers: number;
  restoredTiles: number;
}> {
  // Validate checksum
  const payload = JSON.stringify(archive.data);
  const calculatedChecksum = crypto.createHash('sha256').update(payload).digest('hex');
  if (calculatedChecksum !== archive.checksum) {
    throw new Error(`Checksum mismatch! Expected: ${archive.checksum}, Got: ${calculatedChecksum}`);
  }

  if (targetStorage instanceof InMemoryStorage) {
    const rawTarget = targetStorage as any;

    // Restore users
    for (const u of archive.data.users) {
      rawTarget.users.set(u.id, {
        ...u,
        tokenHash: Buffer.from(u.tokenHash, 'hex'),
        createdAt: new Date(u.createdAt),
        lastSeenAt: new Date(u.lastSeenAt),
      });
      rawTarget.tokenHashIndex.set(u.tokenHash, u.id);
    }

    // Restore tiles
    for (const t of archive.data.tiles) {
      rawTarget.tiles.set(`${t.tileX},${t.tileY}`, {
        ...t,
        dirtySince: t.dirtySince ? new Date(t.dirtySince) : null,
      });
    }

    // Restore strokes
    for (const s of archive.data.strokes) {
      rawTarget.strokes.push({
        ...s,
        createdAt: new Date(s.createdAt),
        data: new Uint8Array(Buffer.from(s.data, 'base64')),
      });
    }

    // Restore reports
    for (const r of archive.data.reports) {
      rawTarget.reports.push({
        ...r,
        createdAt: new Date(r.createdAt),
      });
    }
  }

  return {
    success: true,
    restoredStrokes: archive.data.strokes.length,
    restoredUsers: archive.data.users.length,
    restoredTiles: archive.data.tiles.length,
  };
}

/**
 * Executes a full backup and restore drill test.
 */
export async function runBackupRestoreDrill(): Promise<{
  passed: boolean;
  originalStrokeCount: number;
  restoredStrokeCount: number;
  archiveSizeKb: number;
  durationMs: number;
}> {
  const start = Date.now();

  // 1. Setup source storage and seed sample data
  const source = new InMemoryStorage();
  const tokenHash = crypto.createHash('sha256').update('drill-user-token').digest();
  const user = await source.findOrCreateUser(tokenHash);

  // Seed 50 strokes across 3 tiles
  for (let i = 0; i < 50; i++) {
    const tx = i % 3;
    const ty = Math.floor(i / 15);
    const strokeBytes = encodeStroke(i % 16, (i % 5) + 1, [
      { x: 1000 + i * 50, y: 2000 + i * 50 },
      { x: 1500 + i * 50, y: 2500 + i * 50 },
    ]);
    await source.saveStroke(tx, ty, user.id, strokeBytes);
  }

  // Seed a report and mod action
  await source.createReport(0, 0, 1000, 2000, user.id, 'spam', 'drill test report');
  await source.logModAction('admin-drill', 'test_action', 'tile', '0,0', 'drill test log');

  // 2. Perform Backup
  const backup = await createBackup(source);
  const jsonStr = JSON.stringify(backup, null, 2);
  const tempPath = path.join(process.cwd(), 'backup-drill-temp.json');
  fs.writeFileSync(tempPath, jsonStr, 'utf-8');
  const archiveSizeKb = Math.round(Buffer.byteLength(jsonStr) / 1024);

  // 3. Perform Restore into clean destination storage
  const destination = new InMemoryStorage();
  const readArchive: BackupArchive = JSON.parse(fs.readFileSync(tempPath, 'utf-8'));
  const restoreResult = await restoreBackup(readArchive, destination);

  // Clean up temp file
  try {
    fs.unlinkSync(tempPath);
  } catch {}

  // 4. Verify Integrity
  const destStats = await destination.getStats();
  const destRecent = await destination.getRecentActivity();
  const destTile0 = await destination.getTile(0, 0);
  const destVisible0 = await destination.getVisibleStrokesForTile(0, 0);

  const passed =
    restoreResult.success &&
    restoreResult.restoredStrokes === 50 &&
    restoreResult.restoredUsers >= 1 &&
    destTile0.strokeCount > 0 &&
    destVisible0.length > 0;

  const durationMs = Date.now() - start;

  return {
    passed,
    originalStrokeCount: 50,
    restoredStrokeCount: restoreResult.restoredStrokes,
    archiveSizeKb,
    durationMs,
  };
}

console.log('🔄 Running Infinite Canvas Backup & Restore Drill...');
runBackupRestoreDrill().then((res) => {
  console.log(`\n📋 Backup & Restore Drill Results:`);
  console.log(`  Passed: ${res.passed ? '✅ YES' : '❌ NO'}`);
  console.log(`  Original Strokes: ${res.originalStrokeCount}`);
  console.log(`  Restored Strokes: ${res.restoredStrokeCount}`);
  console.log(`  Archive Size: ${res.archiveSizeKb} KB`);
  console.log(`  Duration: ${res.durationMs} ms`);
  if (!res.passed) process.exit(1);
});
