import { test, expect } from '@playwright/test';

test.describe('R6 nav + toolbar', () => {
  test('tab bar shows Play, Bracket, Pools, My Brackets, My Picks; no Group Picks', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const bar = page.locator('[data-testid="tab-bar"]');
    await expect(bar).toBeVisible();
    await expect(page.locator('[data-testid="tab-play"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-bracket"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-pools"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-my-brackets"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-my-picks"]')).toBeVisible();
    await expect(bar.getByText('Group Picks', { exact: true })).toHaveCount(0);
  });

  test('account button is in the toolbar, not inside any view', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="toolbar-account"]')).toBeVisible();
  });

  test('tapping Play opens the Play funnel at Stage 1', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="tab-play"]').click();
    await expect(page).toHaveURL(/#\/play/);
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });
  });
});
