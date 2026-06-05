import { test, expect } from '@playwright/test';

// R16: the DT Model appears in the model picker and is selectable.
test.describe('R16 DT model', () => {
  test('DT chip renders in the picker and selecting it shows the DT description', async ({ page }) => {
    await page.goto('/#/my-brackets', { waitUntil: 'domcontentloaded' });
    const picker = page.locator('[data-testid="model-picker"]').first();
    await expect(picker).toBeVisible({ timeout: 15_000 });

    const dtChip = picker.locator('[data-testid="model-chip-dt"]');
    await expect(dtChip).toBeVisible();
    await expect(dtChip).toHaveText(/DT Model/);

    await dtChip.click();
    // description updates to the DT model's blurb
    await expect(picker.locator('[data-testid="model-picker-desc"]')).toContainText(/Elo-anchored/i);
    // and the chip is now active
    await expect(dtChip).toHaveClass(/is-active/);
  });

  test('dt_model.json is fetchable as a static data file', async ({ page }) => {
    const res = await page.request.get('/data/dt_model.json');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.model.id).toBe('dt_model');
    expect(Array.isArray(json.team_rankings)).toBeTruthy();
  });
});
