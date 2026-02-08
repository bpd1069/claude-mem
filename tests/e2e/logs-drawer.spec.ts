import { test, expect } from '@playwright/test';

test.describe('Logs Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.settings-btn').waitFor({ state: 'visible', timeout: 10000 });

    // Open the logs drawer
    await page.locator('.console-toggle-btn').click();
    await expect(page.locator('.console-drawer')).toBeVisible();
  });

  test('drawer opens and closes', async ({ page }) => {
    const drawer = page.locator('.console-drawer');
    await expect(drawer).toBeVisible();

    // Close via close button
    const closeBtn = drawer.locator('.console-control-btn').last();
    await closeBtn.click();
    await expect(drawer).not.toBeVisible();

    // Reopen
    await page.locator('.console-toggle-btn').click();
    await expect(drawer).toBeVisible();
  });

  test('drawer has console tab', async ({ page }) => {
    const tab = page.locator('.console-tab');
    await expect(tab).toBeVisible();
    await expect(tab).toHaveText(/Console/);
    await expect(tab).toHaveClass(/active/);
  });

  test('log content area is visible', async ({ page }) => {
    const content = page.locator('.console-content');
    await expect(content).toBeVisible();
  });

  test('level filter chips are present', async ({ page }) => {
    const filters = page.locator('.console-filters');
    await expect(filters).toBeVisible();

    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    for (const level of levels) {
      const chip = filters.locator('.console-filter-chip').filter({ hasText: level }).first();
      await expect(chip).toBeVisible();
    }
  });

  test('component filter chips are present', async ({ page }) => {
    const filters = page.locator('.console-filters');
    const expectedComponents = ['HOOK', 'WORKER', 'SDK', 'PARSER', 'DB', 'SYSTEM', 'HTTP', 'SESSION'];

    for (const comp of expectedComponents) {
      const chip = filters.locator('.console-filter-chip').filter({ hasText: comp }).first();
      await expect(chip).toBeVisible();
    }
  });

  test('clicking a level filter chip toggles it', async ({ page }) => {
    const infoChip = page.locator('.console-filter-chip').filter({ hasText: 'INFO' }).first();
    const wasActive = await infoChip.evaluate((el) => el.classList.contains('active'));

    await infoChip.click();

    const isActive = await infoChip.evaluate((el) => el.classList.contains('active'));
    expect(isActive).not.toBe(wasActive);

    // Toggle back
    await infoChip.click();
    const restored = await infoChip.evaluate((el) => el.classList.contains('active'));
    expect(restored).toBe(wasActive);
  });

  test('clicking component filter chip toggles it', async ({ page }) => {
    const workerChip = page.locator('.console-filter-chip').filter({ hasText: 'WORKER' }).first();
    const wasActive = await workerChip.evaluate((el) => el.classList.contains('active'));

    await workerChip.click();

    const isActive = await workerChip.evaluate((el) => el.classList.contains('active'));
    expect(isActive).not.toBe(wasActive);
  });

  test('all/none filter actions work for levels', async ({ page }) => {
    const filterSections = page.locator('.console-filter-section');

    // Find the level filter section (first one)
    const levelSection = filterSections.first();
    const filterAction = levelSection.locator('.console-filter-action').first();

    if (await filterAction.isVisible()) {
      // Click to toggle all/none
      await filterAction.click();
      await page.waitForTimeout(200);

      // Check that chips changed state
      const chips = levelSection.locator('.console-filter-chip');
      const count = await chips.count();
      if (count > 0) {
        const firstChipActive = await chips.first().evaluate((el) => el.classList.contains('active'));
        // All chips should be in the same state after all/none
        for (let i = 1; i < count; i++) {
          const chipActive = await chips.nth(i).evaluate((el) => el.classList.contains('active'));
          expect(chipActive).toBe(firstChipActive);
        }
      }
    }
  });

  test('auto-refresh checkbox exists', async ({ page }) => {
    const autoRefresh = page.locator('.console-auto-refresh');
    await expect(autoRefresh).toBeVisible();

    const checkbox = autoRefresh.locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
  });

  test('refresh button triggers log fetch', async ({ page }) => {
    // Find refresh button (first control button, typically)
    const controls = page.locator('.console-controls');
    const refreshBtn = controls.locator('.console-control-btn').first();
    await expect(refreshBtn).toBeVisible();

    // Click refresh
    await refreshBtn.click();
    await page.waitForTimeout(500);

    // Content should still be visible (no crash)
    await expect(page.locator('.console-content')).toBeVisible();
  });

  test('resize handle is present', async ({ page }) => {
    const handle = page.locator('.console-resize-handle');
    await expect(handle).toBeVisible();
  });
});
