import { test, expect } from '@playwright/test';

/* rj30-weather.spec.mjs — RJ30-4 weather UI (iPhone 390×844).
 *
 * After the pipeline fix, opening a matchup whose venue-day is populated in
 * weather.json shows a real Weather card (Forecast / Temp °C+°F / Humidity /
 * Wind), keyed by the venue-local match day. A matchup with no populated cell
 * (>15 days out, or no venue) still shows the graceful "not yet available"
 * empty state — never a broken/empty card. No horizontal overflow at 390px.
 */

const weatherSection = (page) =>
  page.locator('.section', { has: page.locator('h2', { hasText: 'Weather' }) });

test('populated venue-day → Weather card shows Forecast + Temp (°C and °F) + Humidity + Wind', async ({ page }) => {
  // Spain vs Austria — R32 at SoFi on 2026-07-02, populated in data/weather.json.
  await page.goto('/#/matchup/team_a/Spain/team_b/Austria', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Spain', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);

  const sec = weatherSection(page);
  await expect(sec).toBeVisible();
  const block = sec.locator('.weather-block');
  await expect(block).toBeVisible();

  // Four labelled rows: Forecast / Temperature / Humidity / Wind.
  await expect(block.locator('.kv')).toHaveCount(4);
  // Temperature row carries both units.
  await expect(block).toContainText('°C');
  await expect(block).toContainText('°F');
});

test('no populated forecast → graceful empty state, never a broken/.weather-block card', async ({ page }) => {
  // The Final (metlife, 2026-07-19) is well beyond the 15-day forecast window,
  // so its venue-day has no cell → the empty state shows, not a forecast card.
  await page.goto('/#/matchup/team_a/W101/team_b/W102', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const sec = weatherSection(page);
  if (await sec.count()) {
    // No forecast card may render; if the section is present it must be the
    // graceful empty state (never a partially-built .weather-block).
    await expect(sec.locator('.weather-block')).toHaveCount(0);
    await expect(sec).toContainText(/not yet available|weather unavailable|No venue/i);
  }
});

test('no horizontal overflow at 390px on the weather matchup', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Spain/team_b/Austria', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Spain', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
