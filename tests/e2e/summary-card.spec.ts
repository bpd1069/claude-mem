import { test, expect } from '@playwright/test';

test.describe('Summary Cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.settings-btn').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('summary cards render with badge and title', async ({ page }) => {
    const summaryCard = page.locator('.summary-card').first();

    // Only test if summaries exist in the feed
    if (await summaryCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(summaryCard.locator('.summary-badge')).toBeVisible();
      await expect(summaryCard.locator('.summary-title')).toBeVisible();
    }
  });

  test('summary cards show structured sections', async ({ page }) => {
    const summaryCard = page.locator('.summary-card').first();

    if (await summaryCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const sections = summaryCard.locator('.summary-section');
      const count = await sections.count();

      // Should have at least one section
      expect(count).toBeGreaterThan(0);

      // Each section has header and content
      for (let i = 0; i < count; i++) {
        const section = sections.nth(i);
        await expect(section.locator('.summary-section-header')).toBeVisible();
        await expect(section.locator('.summary-section-content')).toBeVisible();
      }
    }
  });

  test('summary card footer shows ID and date', async ({ page }) => {
    const summaryCard = page.locator('.summary-card').first();

    if (await summaryCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const footer = summaryCard.locator('.summary-card-footer');
      await expect(footer).toBeVisible();
      await expect(footer.locator('.summary-meta-id')).toBeVisible();
      await expect(footer.locator('.summary-meta-date')).toBeVisible();
    }
  });

  test('summary section icons are visible', async ({ page }) => {
    const summaryCard = page.locator('.summary-card').first();

    if (await summaryCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const icons = summaryCard.locator('.summary-section-icon');
      const count = await icons.count();

      for (let i = 0; i < count; i++) {
        await expect(icons.nth(i)).toBeVisible();
      }
    }
  });
});
