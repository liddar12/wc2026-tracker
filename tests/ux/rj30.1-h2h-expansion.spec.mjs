import { test, expect } from '@playwright/test';

/* rj30.1-h2h-expansion.spec.mjs — RJ30.1 Item 2 (iPhone 390×844).
 *
 * STRUCTURE/DOM assertions only — styling lands in Wave 2. We assert the summary
 * tally + meetings table + preserved pill strip render for a played pairing, the
 * empty state renders (and no table) for a pairing with no history, and there is
 * no horizontal overflow at 390px. */

const h2h = (page) =>
  page.locator('.section', { has: page.locator('h2', { hasText: 'Head-to-head' }) });

test('played pairing → summary + table + biggest-win + preserved pills', async ({ page }) => {
  // USA vs Paraguay — 5 meetings (USA 4, Paraguay 1) in data.
  await page.goto('/#/matchup/team_a/USA/team_b/Paraguay', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);
  const sec = h2h(page);
  await expect(sec).toBeVisible({ timeout: 10_000 });

  await expect(sec.locator('[data-testid="h2h-summary"]')).toBeVisible();
  await expect(sec.locator('[data-testid="h2h-summary"]')).toContainText('Played 5');
  await expect(sec.locator('[data-testid="h2h-table"] .h2h-row')).toHaveCount(5);
  await expect(sec.locator('[data-testid="h2h-biggest"]')).toBeVisible();
  // Pills preserved (no regression).
  await expect(sec.locator('.h2h-strip .pill').first()).toBeVisible();
  await expect(sec.locator('.h2h-strip .pill')).toHaveCount(5);
});

test('summary is computed from the live team_a perspective (USA → W4 L1)', async ({ page }) => {
  await page.goto('/#/matchup/team_a/USA/team_b/Paraguay', { waitUntil: 'domcontentloaded' });
  const summary = h2h(page).locator('[data-testid="h2h-summary"]');
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await expect(summary.locator('.h2h-w')).toHaveText('W4');
  await expect(summary.locator('.h2h-l')).toHaveText('L1');
});

test('no-meetings pairing → empty state, no table', async ({ page }) => {
  // Germany vs Curacao — a scheduled group fixture absent from data/h2h.json.
  await page.goto('/#/matchup/team_a/Germany/team_b/Curacao', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);
  const sec = h2h(page);
  await expect(sec).toBeVisible({ timeout: 10_000 });
  await expect(sec.locator('[data-testid="h2h-empty"]')).toBeVisible();
  await expect(sec.locator('[data-testid="h2h-table"]')).toHaveCount(0);
  await expect(sec.locator('[data-testid="h2h-summary"]')).toHaveCount(0);
});

test('no horizontal overflow at 390px', async ({ page }) => {
  await page.goto('/#/matchup/team_a/USA/team_b/Paraguay', { waitUntil: 'domcontentloaded' });
  await expect(h2h(page).locator('[data-testid="h2h-summary"]')).toBeVisible({ timeout: 10_000 });
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(o).toBeLessThanOrEqual(1);
});
