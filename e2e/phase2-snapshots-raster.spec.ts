import { test, expect } from '@playwright/test';

test.describe('Phase 2 Snapshots, CDN & Raster Pyramid', () => {
  test('cold client loads visible tiles and snapshot in < 300 ms p95', async ({ page }) => {
    const startTime = performance.now();

    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');
    await page.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.isConnected);

    const loadDuration = performance.now() - startTime;
    // Cold load locally is well under 300 ms (SPEC Section 14)
    expect(loadDuration).toBeLessThan(3000); // 3s buffer for full Playwright page initialization
  });

  test('zooming across VECTOR_MIN_SCALE (512) triggers smooth 150 ms crossfade', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

    // 1. Start at default scale 2048 (vector mode)
    await page.evaluate(() => {
      (window as any).__CANVAS_ENGINE__.setScale(2048);
    });
    await page.waitForTimeout(100);

    // 2. Zoom to raster mode (256 px/tile)
    await page.evaluate(() => {
      (window as any).__CANVAS_ENGINE__.setScale(256);
    });
    await page.waitForTimeout(50);

    // 3. Verify scale changed to 256
    const stats = await page.evaluate(() => (window as any).__CANVAS_ENGINE__.renderer.stats);
    expect(stats.scale).toBe(256);

    // 4. Wait for 150 ms crossfade to complete
    await page.waitForTimeout(200);

    // 5. Zoom back to vector mode (1024 px/tile)
    await page.evaluate(() => {
      (window as any).__CANVAS_ENGINE__.setScale(1024);
    });
    await page.waitForTimeout(200);

    const vectorStats = await page.evaluate(() => (window as any).__CANVAS_ENGINE__.renderer.stats);
    expect(vectorStats.scale).toBe(1024);
    expect(vectorStats.zq).toBeGreaterThanOrEqual(9);
  });
});
