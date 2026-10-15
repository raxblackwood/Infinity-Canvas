import { test, expect } from '@playwright/test';

test.describe('Phase 4 Moderation & Admin Tooling E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test('user report modal opens, accepts report, and submits to server', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');
    await page.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.isConnected);
    await page.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.welcomeInfo !== null);

    // Verify report button is visible in toolbar
    const reportBtn = page.getByTestId('btn-report');
    await expect(reportBtn).toBeVisible();

    // Click report button to open modal
    await reportBtn.click();

    const reportModal = page.getByTestId('report-modal');
    await expect(reportModal).toBeVisible();

    // Select report reason
    const reasonSelect = page.getByTestId('report-reason-select');
    await reasonSelect.selectOption('hate_speech');

    // Enter optional note
    const notesInput = page.getByTestId('report-notes-input');
    await notesInput.fill('E2E test reporting offensive drawing');

    // Submit report
    const submitBtn = page.getByTestId('submit-report-btn');
    await submitBtn.click();

    // Modal should close upon successful report
    await expect(reportModal).not.toBeVisible();
  });

  test('admin dashboard can be opened, displays tabs, controls, and executes actions', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => typeof (window as any).__CANVAS_ENGINE__ !== 'undefined');
    await page.waitForFunction(() => (window as any).__CANVAS_ENGINE__.network.isConnected);

    // Open admin dashboard
    const adminBtn = page.getByTestId('btn-admin');
    await expect(adminBtn).toBeVisible();
    await adminBtn.click();

    const adminModal = page.getByTestId('admin-dashboard-modal');
    await expect(adminModal).toBeVisible();

    // Check tabs
    const queueTab = page.getByTestId('admin-tab-queue');
    const bulkTab = page.getByTestId('admin-tab-bulk');
    const usersTab = page.getByTestId('admin-tab-users');
    const auditTab = page.getByTestId('admin-tab-audit');
    const statsTab = page.getByTestId('admin-tab-stats');

    await expect(queueTab).toBeVisible();
    await expect(bulkTab).toBeVisible();
    await expect(usersTab).toBeVisible();
    await expect(auditTab).toBeVisible();
    await expect(statsTab).toBeVisible();

    // Navigate to Stats & Controls
    await statsTab.click();
    await expect(page.getByText('Live Canvas Stats')).toBeVisible();
    await expect(page.getByTestId('admin-killswitch-toggle')).toBeVisible();

    // Navigate to Bulk Moderation
    await bulkTab.click();
    await expect(page.getByTestId('btn-execute-bulk')).toBeVisible();
    await page.getByTestId('bulk-min-tx').fill('0');
    await page.getByTestId('bulk-min-ty').fill('0');
    await page.getByTestId('bulk-max-tx').fill('1');
    await page.getByTestId('bulk-max-ty').fill('1');
    await page.getByTestId('btn-execute-bulk').click();

    // Verify success notice appears
    await expect(page.getByText(/Bulk hide executed/)).toBeVisible();

    // Navigate to Audit Log
    await auditTab.click();
    await expect(page.getByText('Moderation Audit Log')).toBeVisible();
  });
});
