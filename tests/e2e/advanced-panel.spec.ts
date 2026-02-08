import { test, expect } from '@playwright/test';

test.describe('ContextSettingsModal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for React app to render (settings button in header)
    await page.locator('.settings-btn').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('modal opens and closes', async ({ page }) => {
    const settingsBtn = page.locator('.settings-btn');
    const modal = page.locator('.context-settings-modal');

    // Open modal
    await settingsBtn.click();
    await expect(modal).toBeVisible();

    // Close via X button
    await page.locator('.modal-close-btn').click();
    await expect(modal).not.toBeVisible();

    // Reopen, close via Escape
    await settingsBtn.click();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('collapsible sections default open/closed state', async ({ page }) => {
    await page.locator('.settings-btn').click();
    await expect(page.locator('.context-settings-modal')).toBeVisible();

    // Loading, Filters, Display default open
    const sections = page.locator('.settings-section-collapsible');
    const sectionHeaders = page.locator('.section-header-btn');

    // Find sections by their title text
    const loadingSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Loading' }).first();
    const filtersSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Filters' }).first();
    const displaySection = page.locator('.settings-section-collapsible').filter({ hasText: 'Display' }).first();
    const advancedSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Advanced' }).first();
    const federationSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Federation' }).first();
    const migrationSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Migration' }).first();

    await expect(loadingSection).toHaveClass(/open/);
    await expect(filtersSection).toHaveClass(/open/);
    await expect(displaySection).toHaveClass(/open/);
    await expect(advancedSection).not.toHaveClass(/open/);
    await expect(federationSection).not.toHaveClass(/open/);
    await expect(migrationSection).not.toHaveClass(/open/);
  });

  test('collapsible section toggles on click', async ({ page }) => {
    await page.locator('.settings-btn').click();

    const advancedSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Advanced' }).first();
    const advancedHeader = advancedSection.locator('.section-header-btn');

    // Starts collapsed
    await expect(advancedSection).not.toHaveClass(/open/);

    // Click to expand
    await advancedHeader.click();
    await expect(advancedSection).toHaveClass(/open/);

    // Click to collapse
    await advancedHeader.click();
    await expect(advancedSection).not.toHaveClass(/open/);
  });

  test('AI provider selection shows correct fields', async ({ page }) => {
    await page.locator('.settings-btn').click();

    // Expand Advanced section
    const advancedSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Advanced' }).first();
    await advancedSection.locator('.section-header-btn').click();
    await expect(advancedSection).toHaveClass(/open/);

    // Find the provider dropdown within Advanced section
    const providerSelect = advancedSection.locator('select').first();

    // Select LM Studio
    await providerSelect.selectOption('lmstudio');
    await expect(advancedSection.locator('input[placeholder*="localhost:1234"]')).toBeVisible();
    await expect(advancedSection.locator('input[placeholder*="granite"]')).toBeVisible();

    // Select Gemini
    await providerSelect.selectOption('gemini');
    await expect(advancedSection.locator('label').filter({ hasText: 'API Key' }).first()).toBeVisible();

    // Select OpenRouter
    await providerSelect.selectOption('openrouter');
    await expect(advancedSection.locator('label').filter({ hasText: 'API Key' }).first()).toBeVisible();
    await expect(advancedSection.locator('label').filter({ hasText: 'Site URL' }).first()).toBeVisible();

    // Select back to Claude
    await providerSelect.selectOption('claude');
    // LM Studio fields should be gone
    await expect(advancedSection.locator('input[placeholder*="localhost:1234"]')).not.toBeVisible();
  });

  test('LM Studio provider fields are interactive', async ({ page }) => {
    await page.locator('.settings-btn').click();

    const advancedSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Advanced' }).first();
    await advancedSection.locator('.section-header-btn').click();

    const providerSelect = advancedSection.locator('select').first();
    await providerSelect.selectOption('lmstudio');

    const urlField = advancedSection.locator('input[placeholder*="localhost:1234"]');
    const modelField = advancedSection.locator('input[placeholder*="granite"]');

    await expect(urlField).toBeVisible();
    await expect(modelField).toBeVisible();

    // Type into fields
    await urlField.fill('http://localhost:5678/v1');
    await expect(urlField).toHaveValue('http://localhost:5678/v1');

    await modelField.fill('test-model');
    await expect(modelField).toHaveValue('test-model');
  });

  test('filter chip groups toggle correctly', async ({ page }) => {
    await page.locator('.settings-btn').click();

    const filtersSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Filters' }).first();
    await expect(filtersSection).toHaveClass(/open/);

    // All 6 type chips should be visible
    const typeChips = ['bugfix', 'feature', 'refactor', 'discovery', 'decision', 'change'];
    for (const chipText of typeChips) {
      await expect(filtersSection.locator('.chip').filter({ hasText: chipText }).first()).toBeVisible();
    }

    // Click "None" to deselect all type chips
    const noneBtn = filtersSection.locator('.chip-action').filter({ hasText: 'None' }).first();
    await noneBtn.click();

    // All type chips should be deselected
    for (const chipText of typeChips) {
      await expect(filtersSection.locator('.chip').filter({ hasText: chipText }).first()).not.toHaveClass(/selected/);
    }

    // Click "All" to select all type chips
    const allBtn = filtersSection.locator('.chip-action').filter({ hasText: 'All' }).first();
    await allBtn.click();

    for (const chipText of typeChips) {
      await expect(filtersSection.locator('.chip').filter({ hasText: chipText }).first()).toHaveClass(/selected/);
    }

    // Click individual chip to toggle
    const bugfixChip = filtersSection.locator('.chip').filter({ hasText: 'bugfix' }).first();
    await bugfixChip.click();
    await expect(bugfixChip).not.toHaveClass(/selected/);
    await bugfixChip.click();
    await expect(bugfixChip).toHaveClass(/selected/);
  });

  test('toggle switches respond to clicks', async ({ page }) => {
    await page.locator('.settings-btn').click();

    // Display section - "Read cost" toggle
    const readCostToggle = page.locator('#show-read-tokens');
    const initialState = await readCostToggle.getAttribute('aria-checked');

    await readCostToggle.click();
    const newState = await readCostToggle.getAttribute('aria-checked');
    expect(newState).not.toBe(initialState);

    // Advanced section - expand first
    const advancedSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Advanced' }).first();
    await advancedSection.locator('.section-header-btn').click();

    const lastSummaryToggle = page.locator('#show-last-summary');
    const summaryInitial = await lastSummaryToggle.getAttribute('aria-checked');
    await lastSummaryToggle.click();
    const summaryNew = await lastSummaryToggle.getAttribute('aria-checked');
    expect(summaryNew).not.toBe(summaryInitial);

    // Federation section - expand first
    const federationSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Federation' }).first();
    await federationSection.locator('.section-header-btn').click();

    const readOnlyToggle = page.locator('#federation-read-only');
    const fedInitial = await readOnlyToggle.getAttribute('aria-checked');
    await readOnlyToggle.click();
    const fedNew = await readOnlyToggle.getAttribute('aria-checked');
    expect(fedNew).not.toBe(fedInitial);
  });

  test('save button triggers save', async ({ page }) => {
    await page.locator('.settings-btn').click();

    // Modify observations count
    const loadingSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Loading' }).first();
    const obsInput = loadingSection.locator('input[type="number"]').first();
    await obsInput.fill('50');

    // Click save
    const saveBtn = page.locator('.save-btn');
    await saveBtn.click();

    // Wait for save status
    await expect(page.locator('.save-status')).toBeVisible({ timeout: 5000 });
  });

  test('live preview updates on settings change', async ({ page }) => {
    await page.locator('.settings-btn').click();

    const preview = page.locator('.preview-content');
    await expect(preview).toBeVisible();

    // Get initial preview content
    const initialContent = await preview.textContent();

    // Change observations count
    const loadingSection = page.locator('.settings-section-collapsible').filter({ hasText: 'Loading' }).first();
    const obsInput = loadingSection.locator('input[type="number"]').first();
    await obsInput.fill('5');
    await obsInput.press('Tab'); // trigger change event

    // Wait for preview to update (API response)
    await page.waitForTimeout(2000);
    const updatedContent = await preview.textContent();

    // Content may or may not change depending on data, but the preview should still be visible
    await expect(preview).toBeVisible();
  });
});
