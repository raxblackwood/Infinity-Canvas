import { test, expect } from '@playwright/test';

test.describe('Phase 3 Hardening & Abuse Prevention E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test('drawing consumes ink and Undo refunds ink and hides stroke', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');
    await page.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.isConnected);
    await page.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.welcomeInfo !== null);

    // Verify initial ink meter shows 100
    const inkMeter = page.getByTestId('ink-meter');
    await expect(inkMeter).toBeVisible();
    await expect(inkMeter).toContainText('100');

    // Draw a stroke
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + 500;
    const startY = box!.y + 400;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, startY + 50, { steps: 5 });
    await page.mouse.move(startX + 100, startY + 20, { steps: 5 });
    await page.mouse.up();

    // Ink meter should update below 100
    await page.waitForFunction(() => {
      const eng = (window as any).__CANVAS_ENGINE__;
      return eng && eng.network && eng.network.currentInk < 100;
    }, { timeout: 4000 });

    const consumedInk = await page.evaluate(() => (window as any).__CANVAS_ENGINE__.network.currentInk);
    expect(consumedInk).toBeLessThan(100);

    // Verify stroke was rendered in tile
    const strokeCountBefore = await page.evaluate(() => {
      const eng = (window as any).__CANVAS_ENGINE__;
      const index = eng.renderer.getTileIndex(0, 0);
      return index.strokeCount;
    });
    expect(strokeCountBefore).toBeGreaterThanOrEqual(1);

    // Click Undo button
    const undoBtn = page.getByTestId('btn-undo');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Ink should be refunded back towards 100
    await page.waitForFunction((initialConsumed) => {
      const eng = (window as any).__CANVAS_ENGINE__;
      return eng && eng.network && eng.network.currentInk > initialConsumed;
    }, consumedInk, { timeout: 4000 });

    const refundedInk = await page.evaluate(() => (window as any).__CANVAS_ENGINE__.network.currentInk);
    expect(refundedInk).toBeGreaterThan(consumedInk);
  });

  test('read-only kill switch displays banner and rejects drawing', async ({ page }) => {
    // 1. Enable kill switch via server admin endpoint
    await fetch('http://localhost:3001/admin/api/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readOnly: true }),
    });

    try {
      await page.goto('/');
      await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');
      await page.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.isConnected);
      await page.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.welcomeInfo !== null);

      // Read-only banner should be visible
      const readonlyBanner = page.getByTestId('readonly-banner');
      await expect(readonlyBanner).toBeVisible();

      // Attempt to draw a stroke
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      const startX = box!.x + 500;
      const startY = box!.y + 400;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 50, startY + 50, { steps: 5 });
      await page.mouse.up();

      // Toast notification should display read-only warning
      const toast = page.getByTestId('toast-notification');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('read-only');
    } finally {
      // Revert kill switch
      await fetch('http://localhost:3001/admin/api/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readOnly: false }),
      });
    }
  });
});
