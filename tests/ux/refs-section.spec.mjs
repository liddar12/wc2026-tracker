import { test, expect } from '@playwright/test';

/* refs-section.spec.mjs — RJ30-10 (390×844). The referee section renders inside
   the matchup-detail view (already wired). We intercept referees.json +
   match_referees.json to (a) show a real assigned ref, and (b) show the graceful
   "Not yet announced" copy when both are empty. No horizontal overflow at 390px. */

const REF_ID = 'szymon_marciniak';
const FIXTURE_REFS = {
  __meta__: { updated_at: '2026-06-30T00:00:00+00:00' },
  [REF_ID]: {
    ref_id: REF_ID, name: 'Szymon Marciniak',
    confederation: 'UEFA', nationality: 'Poland', stats: {}, history: [],
  },
};
const FIXTURE_ASSIGN = { 'Mexico__vs__South Africa': REF_ID };

async function routeJson(page, file, body) {
  await page.route(`**/${file}`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

test('assigned referee shows a header + the section fits 390px', async ({ page }) => {
  await routeJson(page, 'referees.json', FIXTURE_REFS);
  await routeJson(page, 'match_referees.json', FIXTURE_ASSIGN);
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });

  const refName = page.locator('.ref-header strong');
  await expect(refName).toBeVisible({ timeout: 12_000 });
  await expect(refName).toHaveText(/.+/);
  await expect(page.getByText('Szymon Marciniak', { exact: false }).first()).toBeVisible();

  // No horizontal scroll at the iPhone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(overflow).toBeLessThanOrEqual(390);
});

test('empty directory + no assignment → graceful "Not yet announced" copy', async ({ page }) => {
  await routeJson(page, 'referees.json', {});
  await routeJson(page, 'match_referees.json', {});
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Mexico', { exact: false }).first()).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText(/Not yet announced/i)).toBeVisible();
});
