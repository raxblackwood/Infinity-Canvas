import { Storage } from '../db/storage.js';
import { ModerationProvider, ModerationResult } from './provider.js';

export type BroadcastHideFn = (tileX: number, tileY: number, strokeIds: number[]) => void;

export class ModerationService {
  private storage: Storage;
  private provider: ModerationProvider;
  private broadcastHide: BroadcastHideFn;

  constructor(storage: Storage, provider: ModerationProvider, broadcastHide: BroadcastHideFn) {
    this.storage = storage;
    this.provider = provider;
    this.broadcastHide = broadcastHide;
  }

  getProvider(): ModerationProvider {
    return this.provider;
  }

  setProvider(provider: ModerationProvider): void {
    this.provider = provider;
  }

  /**
   * Scans a rendered tile image buffer with the moderation provider.
   * If flagged:
   * 1. Quarantines recent strokes in the tile (status = 2)
   * 2. Broadcasts 0x88 STROKES_HIDDEN to live subscribers
   * 3. Re-enqueues clean rebake jobs (snapshot and raster)
   * 4. Enqueues an item in review_queue
   */
  async scanTile(tileX: number, tileY: number, imageBuffer: Buffer): Promise<ModerationResult> {
    try {
      const result = await (this.provider as any).scan(imageBuffer, { tileX, tileY });
      if (result.flagged) {
        // 1. Quarantine strokes
        const quarantinedIds = await this.storage.quarantineStrokesForTile(tileX, tileY);

        if (quarantinedIds.length > 0) {
          // 2. Broadcast 0x88 STROKES_HIDDEN
          this.broadcastHide(tileX, tileY, quarantinedIds);

          // 3. Re-bake clean snapshot & raster
          await this.storage.enqueueBakeJob('snapshot', tileX, tileY);
          await this.storage.enqueueBakeJob('raster', tileX, tileY, 0);

          // 4. Enqueue in review_queue
          await this.storage.enqueueReviewItem(
            tileX,
            tileY,
            result.reason || 'Flagged by automated scan',
            quarantinedIds.length,
            5 // automated priority
          );
        }
      }
      return result;
    } catch (err) {
      console.error(`Moderation scan failed for tile (${tileX}, ${tileY}):`, err);
      // Provider failure must never crash or block
      return { flagged: false };
    }
  }

  /**
   * Handles auto-quarantine triggered by multiple user reports on a tile.
   */
  async handleReportQuarantine(tileX: number, tileY: number, quarantinedIds: number[]): Promise<void> {
    if (quarantinedIds.length === 0) return;

    // Broadcast STROKES_HIDDEN
    this.broadcastHide(tileX, tileY, quarantinedIds);

    // Re-bake clean snapshot & raster
    await this.storage.enqueueBakeJob('snapshot', tileX, tileY);
    await this.storage.enqueueBakeJob('raster', tileX, tileY, 0);
  }

  /**
   * Admin restores strokes (e.g. false positive quarantine).
   */
  async restoreStrokes(strokeIds: number[], adminUser: string, reason?: string) {
    const affected = await this.storage.restoreStrokes(strokeIds);

    for (const group of affected) {
      await this.storage.enqueueBakeJob('snapshot', group.tileX, group.tileY);
      await this.storage.enqueueBakeJob('raster', group.tileX, group.tileY, 0);
    }

    await this.storage.logModAction(
      adminUser,
      'restore',
      'stroke',
      strokeIds.join(','),
      reason,
      { count: strokeIds.length, affectedTiles: affected.map((a) => ({ tileX: a.tileX, tileY: a.tileY })) }
    );

    return affected;
  }

  /**
   * Admin permanently hides strokes.
   */
  async hideStrokes(strokeIds: number[], adminUser: string, reason?: string) {
    const affected = await this.storage.hideStrokes(strokeIds);

    for (const group of affected) {
      this.broadcastHide(group.tileX, group.tileY, group.strokeIds);
      await this.storage.enqueueBakeJob('snapshot', group.tileX, group.tileY);
      await this.storage.enqueueBakeJob('raster', group.tileX, group.tileY, 0);
    }

    await this.storage.logModAction(
      adminUser,
      'hide_stroke',
      'stroke',
      strokeIds.join(','),
      reason,
      { count: strokeIds.length, affectedTiles: affected.map((a) => ({ tileX: a.tileX, tileY: a.tileY })) }
    );

    return affected;
  }

  /**
   * Admin bulk-hides strokes by user, tile, bounding region, or time range.
   */
  async bulkHide(
    options: {
      userId?: string;
      tileX?: number;
      tileY?: number;
      minTx?: number;
      minTy?: number;
      maxTx?: number;
      maxTy?: number;
      since?: Date;
      until?: Date;
    },
    adminUser: string,
    reason?: string
  ) {
    const result = await this.storage.bulkHide(options);

    // Group hidden stroke IDs by tile or broadcast hide for affected tiles
    for (const tile of result.affectedTiles) {
      // Re-bake clean snapshot and raster
      await this.storage.enqueueBakeJob('snapshot', tile.tileX, tile.tileY);
      await this.storage.enqueueBakeJob('raster', tile.tileX, tile.tileY, 0);
      this.broadcastHide(tile.tileX, tile.tileY, result.strokeIds);
    }

    await this.storage.logModAction(
      adminUser,
      'bulk_hide',
      options.userId ? 'user' : options.tileX !== undefined ? 'tile' : 'region',
      options.userId || `${options.minTx},${options.minTy} to ${options.maxTx},${options.maxTy}`,
      reason,
      { count: result.strokeIds.length, affectedTilesCount: result.affectedTiles.length, options }
    );

    return result;
  }

  /**
   * Admin bans or unbans a user.
   */
  async setUserBan(userId: string, banned: boolean, adminUser: string, reason?: string): Promise<void> {
    await this.storage.setUserBan(userId, banned);
    await this.storage.logModAction(
      adminUser,
      banned ? 'ban_user' : 'unban_user',
      'user',
      userId,
      reason
    );
  }
}
