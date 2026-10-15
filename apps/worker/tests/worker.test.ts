import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../../server/src/db/storage.js';
import { MemoryObjectStore } from '../../server/src/storage/objectStore.js';
import { BakeWorker } from '../src/runner.js';
import { encodeStroke, decodeTileSnapshot } from '@infinite-canvas/shared';
import { generateTileSvg } from '../src/bake/svg.js';
import { renderTileSvgToWebP } from '../src/bake/raster.js';

describe('BakeWorker & Raster Pipeline', () => {
  let storage: InMemoryStorage;
  let objectStore: MemoryObjectStore;
  let worker: BakeWorker;

  beforeEach(() => {
    storage = new InMemoryStorage();
    objectStore = new MemoryObjectStore();
    worker = new BakeWorker(storage, objectStore, { pollIntervalMs: 50 });
  });

  it('renders SVG to valid WebP image buffer with RIFF/WEBP signature', async () => {
    const strokeData = encodeStroke(3, 2, [
      { x: 10000, y: 10000 },
      { x: 30000, y: 30000 },
      { x: 50000, y: 20000 },
    ]);
    const svg = generateTileSvg([{ id: 1, data: strokeData }]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 65536 65536"');

    const webpBuffer = await renderTileSvgToWebP(svg);
    expect(webpBuffer.length).toBeGreaterThan(100);

    // Verify WebP signature: bytes 0-3 'RIFF', bytes 8-11 'WEBP'
    const headerStr = webpBuffer.subarray(0, 4).toString('ascii');
    const formatStr = webpBuffer.subarray(8, 12).toString('ascii');
    expect(headerStr).toBe('RIFF');
    expect(formatStr).toBe('WEBP');
  });

  it('processes snapshot, level 0 raster, and parent pyramid jobs end-to-end', async () => {
    // 1. Commit strokes to tile (0, 0)
    const user = await storage.findOrCreateUser(Buffer.alloc(32, 1));
    const stroke1 = encodeStroke(1, 2, [{ x: 5000, y: 5000 }, { x: 10000, y: 10000 }]);
    const stroke2 = encodeStroke(4, 3, [{ x: 20000, y: 20000 }, { x: 40000, y: 40000 }]);

    await storage.saveStroke(0, 0, user.id, stroke1);
    await storage.saveStroke(0, 0, user.id, stroke2);

    // Manually run snapshot job without waiting 5s debounce
    await storage.enqueueBakeJob('snapshot', 0, 0, 0, new Date(Date.now() - 1000));

    // 2. Worker executes snapshot job
    const job1Ran = await worker.processNextJob();
    expect(job1Ran).toBe(true);

    const tile = await storage.getTile(0, 0);
    expect(tile.snapshotVersion).toBe(1);
    expect(tile.snapshotKey).toContain('snapshots/0_0_v1.ict1');
    expect(tile.maxStrokeId).toBe(2);

    // Verify snapshot file in object store
    const snapObj = await objectStore.get(tile.snapshotKey!);
    expect(snapObj).not.toBeNull();
    const decodedSnap = decodeTileSnapshot(snapObj!.data);
    expect(decodedSnap.strokeCount).toBe(2);
    expect(decodedSnap.strokes[0].id).toBe(1);
    expect(decodedSnap.strokes[1].id).toBe(2);

    // 3. Worker executes raster level 0 job (which was enqueued by the snapshot job)
    const job2Ran = await worker.processNextJob();
    expect(job2Ran).toBe(true);

    const raster0 = await storage.getRasterTile(0, 0, 0);
    expect(raster0).not.toBeNull();
    expect(raster0!.version).toBe(1);

    const rasterObj = await objectStore.get(raster0!.key);
    expect(rasterObj).not.toBeNull();
    expect(rasterObj!.contentType).toBe('image/webp');
    expect(Buffer.from(rasterObj!.data.subarray(0, 4)).toString('ascii')).toBe('RIFF');

    // 4. Trigger parent level 1 job
    await storage.enqueueBakeJob('raster_parent', 0, 0, 1, new Date(Date.now() - 1000));
    const job3Ran = await worker.processNextJob();
    expect(job3Ran).toBe(true);

    const raster1 = await storage.getRasterTile(1, 0, 0);
    expect(raster1).not.toBeNull();
    const parentObj = await objectStore.get(raster1!.key);
    expect(parentObj).not.toBeNull();
    expect(Buffer.from(parentObj!.data.subarray(0, 4)).toString('ascii')).toBe('RIFF');
  });
});
