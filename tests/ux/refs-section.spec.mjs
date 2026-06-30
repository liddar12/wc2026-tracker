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

// ---- RJ30.1 Item 2: richer assigned-ref panel --------------------------------

const HISTORY_ROWS = [
  // Mexico appears as team_a in 3 rows (n=3 vs Mexico). Mix of confederations so
  // confederationLean has both own (UEFA, via Poland ref) and other samples.
  { team_a: 'Mexico', team_b: 'France', yellows_a: 4, reds_a: 0, penalties_a: 0, yellows_b: 1, reds_b: 0, penalties_b: 0 },
  { team_a: 'Mexico', team_b: 'Germany', yellows_a: 3, reds_a: 0, penalties_a: 1, yellows_b: 2, reds_b: 0, penalties_b: 0 },
  { team_a: 'Mexico', team_b: 'Brazil', yellows_a: 5, reds_a: 1, penalties_a: 0, yellows_b: 2, reds_b: 0, penalties_b: 0 },
  { team_a: 'South Africa', team_b: 'Spain', yellows_a: 2, reds_a: 0, penalties_a: 0, yellows_b: 3, reds_b: 0, penalties_b: 1 },
  { team_a: 'Argentina', team_b: 'England', yellows_a: 1, reds_a: 0, penalties_a: 0, yellows_b: 4, reds_b: 0, penalties_b: 0 },
];

test('assigned ref with empty history → single "no history yet" note, not two empty cards', async ({ page }) => {
  await routeJson(page, 'referees.json', FIXTURE_REFS); // history: []
  await routeJson(page, 'match_referees.json', FIXTURE_ASSIGN);
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.ref-header strong')).toBeVisible({ timeout: 12_000 });
  // Exactly one collapsed note; no per-team empty bias cards.
  await expect(page.locator('[data-testid=ref-history-empty]')).toHaveCount(1);
  await expect(page.locator('.ref-bias-card')).toHaveCount(0);
});

test('assigned ref with real history → bias cards + plain-language line + lean', async ({ page }) => {
  const refs = {
    __meta__: { updated_at: '2026-06-30T00:00:00+00:00' },
    [REF_ID]: {
      ref_id: REF_ID, name: 'Szymon Marciniak',
      confederation: 'UEFA', nationality: 'Poland', stats: { matches_officiated: 40 },
      history: HISTORY_ROWS,
    },
  };
  await routeJson(page, 'referees.json', refs);
  await routeJson(page, 'match_referees.json', FIXTURE_ASSIGN);
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.ref-header strong')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('.ref-bias-card')).toHaveCount(2);
  // Plain-language "% vs average" line for the side with history (Mexico).
  await expect(page.getByText(/cards than average|average number of cards/i).first()).toBeVisible();
  // Confederation lean sentence (cards + penalties lines both start this way).
  await expect(page.getByText(/tends to give/i).first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(overflow).toBeLessThanOrEqual(390);
});

test('diacritics in a ref name render as the exact Unicode (no mojibake / no entities)', async ({ page }) => {
  const refs = {
    __meta__: { updated_at: '2026-06-30T00:00:00+00:00' },
    [REF_ID]: {
      ref_id: REF_ID, name: 'Szymon Marciñiak',
      confederation: 'UEFA', nationality: 'Türkiye', stats: {}, history: [],
    },
  };
  await routeJson(page, 'referees.json', refs);
  await routeJson(page, 'match_referees.json', FIXTURE_ASSIGN);
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Szymon Marciñiak', { exact: false })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText('Türkiye', { exact: false })).toBeVisible();
});
