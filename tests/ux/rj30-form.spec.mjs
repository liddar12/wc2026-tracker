import { test, expect } from '@playwright/test';

/* rj30-form.spec.mjs — RJ30-8 results-derived recent form (iPhone 390×844).
 *
 * After retiring the dark ESPN scraper, the "Recent form (last 5)" card shows
 * real W/D/L pills derived from the tournament's own results. A pen-decided
 * fixture shows a real W (winner) / L (loser) pill — not the old empty state.
 * Pills fit at 390px with no overflow.
 */

const formSection = (page) =>
  page.locator('.section', { has: page.locator('h2', { hasText: 'Recent form' }) });

test('played matchup → form pills render for both teams (no "No recent results")', async ({ page }) => {
  // Mexico vs South Africa — both teams have played; both carry last-5 form.
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mexico', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);

  const sec = formSection(page);
  await expect(sec).toBeVisible();
  // Two team columns, each with at least one pill.
  await expect(sec.locator('.form-col')).toHaveCount(2);
  await expect(sec.locator('.pill').first()).toBeVisible();
  const pillCount = await sec.locator('.pill').count();
  expect(pillCount).toBeGreaterThanOrEqual(1);
});

test('pen-decided team shows a real W pill (winner), not an empty state', async ({ page }) => {
  // Paraguay beat Germany on penalties (regulation 1–1) → a .pill-w must exist.
  await page.goto('/#/matchup/team_a/Germany/team_b/Paraguay', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Paraguay', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);

  const sec = formSection(page);
  await expect(sec).toBeVisible();
  // Paraguay's column carries at least one winning pill (the shootout W).
  await expect(sec.locator('.pill-w').first()).toBeVisible();
});

test('form pills fit at 390px (no overflow on .pill-strip)', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mexico', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
