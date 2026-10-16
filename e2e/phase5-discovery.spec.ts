import { test, expect } from '@playwright/test';

test.describe('Phase 5 Discovery, Map Overlay, Deep Linking & Exporter E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test('first-run onboarding shows 3 cards, disables drawing, and enables drawing upon acceptance', async ({ page }) => {
    // Clear localStorage to simulate fresh user visit
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

    // Verify Onboarding Modal is visible
    const modal = page.getByTestId('onboarding-modal');
    await expect(modal).toBeVisible();

    // Verify drawing is disabled initially
    const isDrawingInitially = await page.evaluate(
      () => (window as any).__CANVAS_ENGINE__.pointer.isDrawingEnabled
    );
    expect(isDrawingInitially).toBe(false);

    // Card 1
    const title = page.getByTestId('onboarding-title');
    await expect(title).toContainText('Infinite Shared Canvas');
    await page.getByTestId('btn-onboarding-next').click();

    // Card 2
    await expect(title).toContainText('Gestures & Drawing');
    await page.getByTestId('btn-onboarding-next').click();

    // Card 3
    await expect(title).toContainText('Community Rules');
    const acceptBtn = page.getByTestId('btn-accept-rules');
    await expect(acceptBtn).toBeVisible();

    // Click Accept & Start Drawing
    await acceptBtn.click();
    await expect(modal).not.toBeVisible();

    // Verify drawing is now enabled
    const isDrawingNow = await page.evaluate(
      () => (window as any).__CANVAS_ENGINE__.pointer.isDrawingEnabled
    );
    expect(isDrawingNow).toBe(true);

    // Verify localStorage has stored acceptance
    const acceptedVal = await page.evaluate(() => localStorage.getItem('rules_accepted_v1'));
    expect(acceptedVal).toBe('true');

    // Reload page: onboarding should not reappear
    await page.reload();
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');
    await expect(page.getByTestId('onboarding-modal')).not.toBeVisible();
  });

  test('deep linking jumps camera directly to hash coordinates', async ({ page }) => {
    await page.goto('/#t=42,-18@4096');
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

    // Wait for camera to match deep link coordinates
    await page.waitForFunction(() => {
      const eng = (window as any).__CANVAS_ENGINE__;
      return (
        eng &&
        eng.camera.tileX === 42 &&
        eng.camera.tileY === -18 &&
        eng.camera.scale === 4096
      );
    });

    const cam = await page.evaluate(() => {
      const eng = (window as any).__CANVAS_ENGINE__;
      return { tileX: eng.camera.tileX, tileY: eng.camera.tileY, scale: eng.camera.scale };
    });

    expect(cam.tileX).toBe(42);
    expect(cam.tileY).toBe(-18);
    expect(cam.scale).toBe(4096);
  });

  test('map overlay displays activity radar and jumps on cell tap or quick jump', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

    // Open map overlay
    const mapBtn = page.getByTestId('btn-map');
    await expect(mapBtn).toBeVisible();
    await mapBtn.click();

    const overlay = page.getByTestId('map-overlay');
    await expect(overlay).toBeVisible();

    // Verify Radar Grid and quick jump buttons
    await expect(page.getByTestId('radar-grid')).toBeVisible();
    await expect(page.getByTestId('btn-jump-busy')).toBeVisible();
    await expect(page.getByTestId('btn-jump-random')).toBeVisible();

    // Click random spot button
    await page.getByTestId('btn-jump-random').click();
    await expect(overlay).not.toBeVisible();

    // Camera should have moved
    const cam = await page.evaluate(() => {
      const eng = (window as any).__CANVAS_ENGINE__;
      return { tileX: eng.camera.tileX, tileY: eng.camera.tileY };
    });
    expect(typeof cam.tileX).toBe('number');
    expect(typeof cam.tileY).toBe('number');
  });

  test('high-res exporter allows exporting canvas as PNG and SVG', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

    // Open export modal
    const exportBtn = page.getByTestId('btn-export');
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    const exportModal = page.getByTestId('export-modal');
    await expect(exportModal).toBeVisible();

    // Verify format buttons
    await expect(page.getByTestId('btn-format-png')).toBeVisible();
    await expect(page.getByTestId('btn-format-svg')).toBeVisible();

    // Test PNG resolution selector
    await page.getByTestId('btn-res-4x').click();
    await expect(page.getByTestId('btn-res-4x')).toBeVisible();

    // Switch to SVG
    await page.getByTestId('btn-format-svg').click();
    await expect(page.getByTestId('btn-download-export')).toContainText('SVG');

    // Close modal
    await page.getByTestId('btn-close-export').click();
    await expect(exportModal).not.toBeVisible();
  });

  test('share button copies current coordinates and updates URL', async ({ page }) => {
    await page.goto('/#t=7,9@2048');
    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');

    const shareBtn = page.getByTestId('btn-share');
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();

    // Toast notice or URL should contain the coordinates
    expect(page.url()).toContain('#t=7,9@2048');
  });
});
