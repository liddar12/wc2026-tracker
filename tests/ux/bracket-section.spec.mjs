import { test, expect } from '@playwright/test';

test.describe('Bracket section — Live | Projected', () => {
  test.beforeEach(async ({ page }) => {
    // Bracket tab is hidden from nav (owner request) but the route still works;
    // navigate by URL to validate the section's internals.
    await page.goto('/#/bracket', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/#\/bracket/);
  });

  test('mode toggle renders Live and Projected; default is Live', async ({ page }) => {
    const toggle = page.locator('[data-testid="bracket-mode-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="bracket-mode-live"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-testid="bracket-live"]')).toBeVisible();
    await expect(page.locator('[data-testid="bracket-group-info"]')).toBeVisible();
  });

  test('switching to Projected shows source selector', async ({ page }) => {
    await page.locator('[data-testid="bracket-mode-projected"]').click();
    await expect(page.locator('[data-testid="bracket-projected"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="bracket-source-select"]')).toBeVisible();
  });

  test('switching projection source changes URL + repaints', async ({ page }) => {
    await page.locator('[data-testid="bracket-mode-projected"]').click();
    await expect(page.locator('[data-testid="bracket-source-select"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="bracket-source-select"]').selectOption('kalshi');
    await expect(page).toHaveURL(/source\/kalshi/);
  });

  test('group info grid renders 12 cards', async ({ page }) => {
    await expect(page.locator('[data-testid="bracket-group-info"]')).toBeVisible({ timeout: 10_000 });
    // Match only the 12 lettered group cards (avoid matching the wrapper)
    const cards = page.locator('[data-testid="bracket-group-info"] >> [data-testid^="bracket-group-"]');
    await expect(cards).toHaveCount(12);
  });
});
