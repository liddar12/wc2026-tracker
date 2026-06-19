import { test, expect } from '@playwright/test';

test.describe('R6 nav + toolbar', () => {
  test('low-use tabs hidden; Schedule + Projected shown (reversible flag)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const bar = page.locator('[data-testid="tab-bar"]');
    await expect(bar).toBeVisible();
    // Deliberately hidden per owner request (still routable by URL).
    for (const t of ['tab-play', 'tab-bracket', 'tab-pools', 'tab-my-brackets', 'tab-my-picks']) {
      await expect(page.locator(`[data-testid="${t}"]`)).toBeHidden();
    }
    await expect(page.locator('[data-testid="tab-schedule"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-projected"]')).toBeVisible();
  });

  test('account button is in the toolbar, not inside any view', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="toolbar-account"]')).toBeVisible();
  });

  test('Play route still opens the funnel by URL (tab hidden, route intact)', async ({ page }) => {
    await page.goto('/#/play', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });
  });
});
