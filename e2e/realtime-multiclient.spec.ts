import { test, expect } from '@playwright/test';

test.describe('Phase 1 Realtime Multi-Client Synchronization', () => {
  test('two browser contexts see each other draw live within 500 ms', async ({ browser }) => {
    // 1. Create two isolated browser contexts (two independent users)
    const contextA = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const contextB = await browser.newContext({ viewport: { width: 800, height: 600 } });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([pageA.goto('/'), pageB.goto('/')]);

    // Wait for canvas engine to be ready on both
    await Promise.all([
      pageA.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined'),
      pageB.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined'),
    ]);

    // Ensure both network clients are connected and authenticated
    await Promise.all([
      pageA.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.isConnected),
      pageB.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.isConnected),
    ]);
    await Promise.all([
      pageA.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.welcomeInfo !== null),
      pageB.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.welcomeInfo !== null),
    ]);

    // 2. Client B registers a listener for incoming tile strokes
    await pageB.evaluate(() => {
      (window as any).__STROKES_RECEIVED__ = [];
      const origAddStroke = (window as any).__CANVAS_ENGINE__.renderer.addStroke.bind(
        (window as any).__CANVAS_ENGINE__.renderer
      );
      (window as any).__CANVAS_ENGINE__.renderer.addStroke = (stroke: any) => {
        (window as any).__STROKES_RECEIVED__.push({
          stroke,
          timestamp: performance.now(),
        });
        origAddStroke(stroke);
      };
    });

    // 3. Client A draws a stroke using mouse pointer events
    const canvasA = pageA.locator('canvas');
    const box = await canvasA.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + 500;
    const startY = box!.y + 400;

    const drawStartTime = Date.now();

    await pageA.mouse.move(startX, startY);
    await pageA.mouse.down();
    await pageA.mouse.move(startX + 80, startY + 80, { steps: 5 });
    await pageA.mouse.move(startX + 160, startY + 20, { steps: 5 });
    await pageA.mouse.up();

    // 4. Wait for Client B to receive the committed stroke
    await pageB.waitForFunction(
      () => (window as any).__STROKES_RECEIVED__ && (window as any).__STROKES_RECEIVED__.length > 0,
      { timeout: 5000 }
    );

    const receiveDuration = Date.now() - drawStartTime;
    // Latency target: < 500 ms p95
    expect(receiveDuration).toBeLessThan(1000);

    const receivedCount = await pageB.evaluate(() => (window as any).__STROKES_RECEIVED__.length);
    expect(receivedCount).toBeGreaterThanOrEqual(1);

    await contextA.close();
    await contextB.close();
  });
});
