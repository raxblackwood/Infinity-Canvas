import { Storage, ObjectStore } from '@infinite-canvas/server';
import { encodeTileSnapshot } from '@infinite-canvas/shared';
import { generateTileSvg } from './bake/svg.js';
import { renderTileSvgToWebP, compositeParentPyramidTile } from './bake/raster.js';

export class BakeWorker {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private pollIntervalMs: number;

  constructor(
    private storage: Storage,
    private objectStore: ObjectStore,
    options: { pollIntervalMs?: number } = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs || 1000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const worked = await this.processNextJob();
        if (!worked && this.running) {
          await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
      } catch (err) {
        console.error('Worker loop error:', err);
        if (this.running) {
          await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
      }
    }
  }

  /**
   * Claims and processes a single bake job. Returns true if a job was found and handled.
   */
  async processNextJob(): Promise<boolean> {
    const job = await this.storage.claimBakeJob();
    if (!job) return false;

    try {
      if (job.kind === 'snapshot') {
        await this.handleSnapshotJob(job.tileX, job.tileY);
      } else if (job.kind === 'raster_level_0') {
        await this.handleRasterLevel0Job(job.tileX, job.tileY);
      } else if (job.kind === 'raster_parent') {
        await this.handleRasterParentJob(job.level, job.tileX, job.tileY);
      }

      await this.storage.completeBakeJob(job.id);
      return true;
    } catch (err) {
      console.error(`Failed job #${job.id} (${job.kind}):`, err);
      await this.storage.failBakeJob(job.id, 5000);
      return true;
    }
  }

  private async handleSnapshotJob(tileX: number, tileY: number): Promise<void> {
    const strokes = await this.storage.getVisibleStrokesForTile(tileX, tileY);
    const tile = await this.storage.getTile(tileX, tileY);
    const nextVersion = tile.snapshotVersion + 1;
    const maxStrokeId = strokes.length > 0 ? strokes[strokes.length - 1].id : 0;

    const snapshotBinary = encodeTileSnapshot({
      tileX,
      tileY,
      version: nextVersion,
      maxStrokeId,
      strokeCount: strokes.length,
      strokes,
    });

    const key = `snapshots/${tileX}_${tileY}_v${nextVersion}.ict1`;
    await this.objectStore.put(key, snapshotBinary, 'application/octet-stream');
    await this.storage.updateTileSnapshot(tileX, tileY, nextVersion, key, maxStrokeId);

    // Enqueue raster level 0 bake
    await this.storage.enqueueBakeJob('raster_level_0', tileX, tileY, 0, new Date());
  }

  private async handleRasterLevel0Job(tileX: number, tileY: number): Promise<void> {
    const strokes = await this.storage.getVisibleStrokesForTile(tileX, tileY);
    const svg = generateTileSvg(strokes);
    const webpBuffer = await renderTileSvgToWebP(svg);

    const tile = await this.storage.getTile(tileX, tileY);
    const version = tile.snapshotVersion || 1;
    const key = `raster/0/${tileX}_${tileY}_v${version}.webp`;

    await this.objectStore.put(key, webpBuffer, 'image/webp');
    await this.storage.saveRasterTile(0, tileX, tileY, version, key);

    // Enqueue parent level 1 bake (debounced by 30s)
    const parentX = Math.floor(tileX / 2);
    const parentY = Math.floor(tileY / 2);
    await this.storage.enqueueBakeJob(
      'raster_parent',
      parentX,
      parentY,
      1,
      new Date(Date.now() + 30000)
    );
  }

  private async handleRasterParentJob(level: number, px: number, py: number): Promise<void> {
    const fetchChild = async (cx: number, cy: number): Promise<Buffer | null> => {
      const record = await this.storage.getRasterTile(level - 1, cx, cy);
      if (!record) return null;
      const obj = await this.objectStore.get(record.key);
      return obj ? Buffer.from(obj.data) : null;
    };

    const [tl, tr, bl, br] = await Promise.all([
      fetchChild(px * 2, py * 2),
      fetchChild(px * 2 + 1, py * 2),
      fetchChild(px * 2, py * 2 + 1),
      fetchChild(px * 2 + 1, py * 2 + 1),
    ]);

    if (!tl && !tr && !bl && !br) {
      return; // No child tiles exist
    }

    const parentWebp = await compositeParentPyramidTile({ tl, tr, bl, br });
    const version = Date.now();
    const key = `raster/${level}/${px}_${py}_v${version}.webp`;

    await this.objectStore.put(key, parentWebp, 'image/webp');
    await this.storage.saveRasterTile(level, px, py, version, key);

    // If level < 12, enqueue next level up
    if (level < 12) {
      const nextPx = Math.floor(px / 2);
      const nextPy = Math.floor(py / 2);
      await this.storage.enqueueBakeJob(
        'raster_parent',
        nextPx,
        nextPy,
        level + 1,
        new Date(Date.now() + 30000)
      );
    }
  }
}
