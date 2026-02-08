import { test, expect } from '@playwright/test';

test.describe('Header', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.settings-btn').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('header renders with all elements', async ({ page }) => {
    const header = page.locator('.header');
    await expect(header).toBeVisible();
    await expect(header.locator('.logomark')).toBeVisible();
    await expect(header.locator('.logo-text')).toBeVisible();
    await expect(header.locator('.theme-toggle-btn')).toBeVisible();
    await expect(header.locator('.settings-btn')).toBeVisible();
  });

  test('project filter dropdown works', async ({ page }) => {
    const projectSelect = page.locator('.header select');
    await expect(projectSelect).toBeVisible();

    // First option is "All Projects"
    const firstOption = projectSelect.locator('option').first();
    await expect(firstOption).toHaveText('All Projects');

    // Select a project if available, then reset to all
    const optionCount = await projectSelect.locator('option').count();
    if (optionCount > 1) {
      const secondOption = projectSelect.locator('option').nth(1);
      const projectName = await secondOption.textContent();
      await projectSelect.selectOption({ index: 1 });

      // Feed should still be visible after filter
      await expect(page.locator('.feed')).toBeVisible();

      // Reset to all
      await projectSelect.selectOption('');
      await expect(page.locator('.feed')).toBeVisible();
    }
  });

  test('theme toggle cycles through modes', async ({ page }) => {
    const themeBtn = page.locator('.theme-toggle-btn');
    const html = page.locator('html');

    // Get initial title
    const initialTitle = await themeBtn.getAttribute('title');

    // Click to cycle theme
    await themeBtn.click();
    const secondTitle = await themeBtn.getAttribute('title');
    expect(secondTitle).not.toBe(initialTitle);

    // Click again
    await themeBtn.click();
    const thirdTitle = await themeBtn.getAttribute('title');
    expect(thirdTitle).not.toBe(secondTitle);

    // Click once more to complete cycle
    await themeBtn.click();
    const fourthTitle = await themeBtn.getAttribute('title');
    expect(fourthTitle).toBe(initialTitle);
  });

  test('theme persists in data-theme attribute', async ({ page }) => {
    const themeBtn = page.locator('.theme-toggle-btn');
    const html = page.locator('html');

    // Click until we get to 'light' theme
    for (let i = 0; i < 3; i++) {
      const attr = await html.getAttribute('data-theme');
      if (attr === 'light') break;
      await themeBtn.click();
    }

    const theme = await html.getAttribute('data-theme');
    // Should have a data-theme attribute set
    expect(theme).toBeTruthy();
  });

  test('settings button opens modal', async ({ page }) => {
    await page.locator('.settings-btn').click();
    await expect(page.locator('.context-settings-modal')).toBeVisible();
  });

  test('console toggle button opens logs drawer', async ({ page }) => {
    const consoleBtn = page.locator('.console-toggle-btn');
    await expect(consoleBtn).toBeVisible();

    await consoleBtn.click();
    await expect(page.locator('.console-drawer')).toBeVisible();
  });

  test('external links have correct targets', async ({ page }) => {
    const iconLinks = page.locator('.header .icon-link');
    const count = await iconLinks.count();

    for (let i = 0; i < count; i++) {
      const link = iconLinks.nth(i);
      const target = await link.getAttribute('target');
      expect(target).toBe('_blank');
    }
  });
});
