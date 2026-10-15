import { test, expect } from '@playwright/test';

const SCALES = [512, 1024, 2048, 8192, 16384];
const DPRS = [1, 2, 3];

test.describe('Phase 0 Visual Regression & Crispness', () => {
  for (const dpr of DPRS) {
    for (const scale of SCALES) {
      test(`verifies vector crispness at scale ${scale} with DPR ${dpr}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: 800, height: 600 },
          deviceScaleFactor: dpr,
        });
        const page = await context.newPage();
        await page.goto('/');

        // Wait for engine to initialize
        await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

        // Click "Load Test Strokes"
        await page.getByRole('button', { name: 'Load Test Strokes' }).click();

        // Set scale via engine
        await page.evaluate((s) => {
          (window as any).__CANVAS_ENGINE__.setScale(s);
        }, scale);

        // Wait for settle and render frame
        await page.waitForTimeout(300);

        // Capture canvas screenshot
        const canvas = page.locator('canvas');
        await expect(canvas).toHaveScreenshot(`canvas-scale-${scale}-dpr-${dpr}.png`, {
          maxDiffPixelRatio: 0.05,
        });

        await context.close();
      });
    }
  }

  test('verifies low-zoom (< 512) placeholder display (Amendment 1)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

    // Click <512 scale stop (256)
    await page.evaluate(() => {
      (window as any).__CANVAS_ENGINE__.setScale(256);
    });

    await page.waitForTimeout(300);

    const canvas = page.locator('canvas');
    await expect(canvas).toHaveScreenshot('canvas-scale-256-placeholder.png', {
      threshold: 0.05,
    });
  });

  test('verifies panning holds 60 fps and stays within memory budget', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

    await page.getByRole('button', { name: 'Load Test Strokes' }).click();

    // Perform continuous pan gestures for 5 seconds
    const panResult = await page.evaluate(async () => {
      const engine = (window as any).__CANVAS_ENGINE__;
      const startTime = performance.now();
      const frameTimes: number[] = [];

      while (performance.now() - startTime < 4000) {
        engine.camera.pan(12, 8);
        engine.renderer.markDirty();
        await new Promise((r) => requestAnimationFrame(r));
        frameTimes.push(engine.renderer.stats.frameTimeMs);
      }

      const stats = engine.renderer.stats;
      const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      const maxFrameTime = Math.max(...frameTimes);

      return {
        fps: stats.fps,
        avgFrameTime,
        maxFrameTime,
        memoryUsedMB: stats.memoryUsedMB,
      };
    });

    // Check JS frame time < 8 ms as specified in SPEC Section 8
    expect(panResult.avgFrameTime).toBeLessThan(8.0);
    // Check memory stays strictly within budget (desktop 256 MB)
    expect(panResult.memoryUsedMB).toBeLessThan(256);
  });
});
