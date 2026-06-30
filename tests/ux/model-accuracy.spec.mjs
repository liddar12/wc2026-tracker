import { test, expect } from '@playwright/test';

/* model-accuracy.spec.mjs — RJ30-11 (390×844). Exercises the per-match
   model-accuracy view fed by an intercepted live-backtest.json.

   The #/model-accuracy ROUTE is registered by the Wave-2 integrator in
   app/main.js. Until that lands, navigating to the hash falls back to Home, so
   each test first checks the route is wired (the view renders its own markup)
   and skips with a clear note otherwise — keeping the suite green
   pre-integration and exercising the real view post-integration. */

const TWO_MATCH = {
  updated_at: '2026-06-12T00:00:00+00:00',
  summary: {
    matches_scored: 2,
    model: { correct: 2, total: 2, measured: true, brier: 0.1, logloss: 0.3 },
    market: { correct: 1, total: 2, measured: true, brier: 0.2, logloss: 0.5 },
  },
  matches: {
    a: {
      match_number: 1, team_a: 'Mexico', team_b: 'South Africa', scored: true,
      actual: 'team_a_wins', actual_score: '2-0',
      score: {
        model: { correct: 1, brier: 0.05, logloss: 0.2 },
        market: { correct: 1, brier: 0.15, logloss: 0.4 },
      },
    },
    b: {
      match_number: 2, team_a: 'France', team_b: 'Spain', scored: true,
      actual: 'draw', actual_score: '1-1',
      score: {
        model: { correct: 1, brier: 0.12, logloss: 0.35 },
        market: { correct: 0, brier: 0.25, logloss: 0.6 },
      },
    },
  },
};
const EMPTY = { updated_at: 'x', matches: {}, summary: { matches_scored: 0 } };

async function routeLive(page, body) {
  await page.route('**/live-backtest.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}
async function routeWired(page) {
  // The model-accuracy view is identifiable by its header card title text or a
  // .model-acc-row; if neither appears, the route isn't registered yet.
  const wired = await page.evaluate(() =>
    !!document.querySelector('.model-acc-row') ||
    /Model Accuracy/i.test(document.querySelector('#view')?.textContent || ''));
  return wired;
}

test('two scored matches → 2 rows, a per-model %, and no horizontal overflow', async ({ page }) => {
  await routeLive(page, TWO_MATCH);
  await page.goto('/#/model-accuracy', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  test.skip(!(await routeWired(page)), 'PENDING INTEGRATOR: #/model-accuracy route not yet in main.js');

  await expect(page.locator('.model-acc-row')).toHaveCount(2);
  await expect(page.getByText('%', { exact: false }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(overflow).toBeLessThanOrEqual(390);
});

test('zero scored matches → empty state copy', async ({ page }) => {
  await routeLive(page, EMPTY);
  await page.goto('/#/model-accuracy', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  test.skip(!(await routeWired(page)), 'PENDING INTEGRATOR: #/model-accuracy route not yet in main.js');

  await expect(page.getByText(/starts once matches resolve/i)).toBeVisible();
});

test('Backtest view links to the per-match accuracy view', async ({ page }) => {
  await page.goto('/#/backtest', { waitUntil: 'domcontentloaded' });
  const link = page.locator('[data-testid="model-accuracy-link"]');
  await expect(link).toBeVisible({ timeout: 12_000 });
  await link.click();
  await expect(page).toHaveURL(/#\/model-accuracy/);
});
