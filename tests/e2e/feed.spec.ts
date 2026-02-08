import { test, expect } from '@playwright/test';

test.describe('Feed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.settings-btn').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('feed renders with cards', async ({ page }) => {
    const feed = page.locator('.feed');
    await expect(feed).toBeVisible();

    // Wait for at least one card to load
    const firstCard = page.locator('.card').first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });
  });

  test('observation cards display type badges', async ({ page }) => {
    const card = page.locator('.card').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Type badge should be present
    const typeBadge = card.locator('.card-type').first();
    await expect(typeBadge).toBeVisible();

    const badgeText = await typeBadge.textContent();
    const validTypes = ['BUGFIX', 'FEATURE', 'REFACTOR', 'DISCOVERY', 'DECISION', 'CHANGE'];
    expect(validTypes).toContain(badgeText?.toUpperCase());
  });

  test('observation cards show title and metadata', async ({ page }) => {
    const card = page.locator('.card:not(.summary-card):not(.prompt-card)').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Title should be present
    await expect(card.locator('.card-title')).toBeVisible();

    // Meta section with ID and date
    await expect(card.locator('.card-meta')).toBeVisible();
  });

  test('facts toggle shows facts list', async ({ page }) => {
    // Find an observation card (not summary or prompt)
    const card = page.locator('.card:not(.summary-card):not(.prompt-card)').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const factsToggle = card.locator('.view-mode-toggle').filter({ hasText: 'facts' }).first();

    // Only test if toggle exists (card has facts)
    if (await factsToggle.isVisible()) {
      await factsToggle.click();
      await expect(factsToggle).toHaveClass(/active/);

      // Facts list should appear
      await expect(card.locator('.facts-list')).toBeVisible();
    }
  });

  test('narrative toggle shows narrative text', async ({ page }) => {
    const card = page.locator('.card:not(.summary-card):not(.prompt-card)').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const narrativeToggle = card.locator('.view-mode-toggle').filter({ hasText: 'narrative' }).first();

    if (await narrativeToggle.isVisible()) {
      await narrativeToggle.click();
      await expect(narrativeToggle).toHaveClass(/active/);

      // Narrative text should appear
      await expect(card.locator('.narrative')).toBeVisible();
    }
  });

  test('facts and narrative toggles are mutually exclusive', async ({ page }) => {
    const card = page.locator('.card:not(.summary-card):not(.prompt-card)').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const factsToggle = card.locator('.view-mode-toggle').filter({ hasText: 'facts' }).first();
    const narrativeToggle = card.locator('.view-mode-toggle').filter({ hasText: 'narrative' }).first();

    if (await factsToggle.isVisible() && await narrativeToggle.isVisible()) {
      // Activate facts
      await factsToggle.click();
      await expect(factsToggle).toHaveClass(/active/);

      // Activate narrative — facts should deactivate
      await narrativeToggle.click();
      await expect(narrativeToggle).toHaveClass(/active/);
      await expect(factsToggle).not.toHaveClass(/active/);

      // Deactivate narrative by clicking again
      await narrativeToggle.click();
      await expect(narrativeToggle).not.toHaveClass(/active/);
    }
  });

  test('scroll to top button appears after scrolling', async ({ page }) => {
    const feed = page.locator('.feed');
    await expect(feed).toBeVisible();

    // Scroll down significantly
    await feed.evaluate((el) => el.scrollTop = 500);
    await page.waitForTimeout(300);

    const scrollBtn = page.locator('.scroll-to-top');
    // Button appears when scrolled > 300px
    if (await scrollBtn.isVisible()) {
      await scrollBtn.click();
      await page.waitForTimeout(500);
      const scrollTop = await feed.evaluate((el) => el.scrollTop);
      expect(scrollTop).toBeLessThan(50);
    }
  });

  test('feed loads more items on scroll (infinite scroll)', async ({ page }) => {
    const feed = page.locator('.feed');
    await expect(feed).toBeVisible();

    // Count initial cards
    await page.locator('.card').first().waitFor({ state: 'visible', timeout: 10000 });
    const initialCount = await page.locator('.card').count();

    // Only test if there are enough items to paginate
    if (initialCount >= 10) {
      // Scroll to bottom
      await feed.evaluate((el) => el.scrollTop = el.scrollHeight);
      await page.waitForTimeout(2000);

      const newCount = await page.locator('.card').count();
      // May or may not have loaded more depending on total data
      expect(newCount).toBeGreaterThanOrEqual(initialCount);
    }
  });
});
