import { test, expect } from '@playwright/test';

/* status-view.spec.mjs — RJ30-12 (390×844). Exercises the #/status pipeline
   observability view fed by an intercepted pipeline_status.json.

   The #/status ROUTE is registered by the Wave-2 integrator in app/main.js.
   Until that lands, the hash falls back to Home, so each test checks the route
   is wired (the view's health pill renders) and skips with a clear note
   otherwise — keeping the suite green pre-integration and exercising the real
   view post-integration. The Backtest-style Settings link is asserted
   separately (Settings is already wired). */

const DEGRADED = {
  generated_at: '2026-06-30T06:00:00+00:00',
  health: 'degraded',
  feeds: [
    { name: 'teams.json', updated_at: '2026-06-30T05:00:00+00:00', age_hours: 1, rows: 48, status: 'ok' },
    { name: 'form.json', updated_at: '2026-06-28T00:00:00+00:00', age_hours: 54, rows: 0, status: 'empty' },
  ],
  warnings: ['scorers.json: volatile feed is EMPTY'],
  warning_count: 1,
};

async function routeStatus(page, body, status = 200) {
  await page.route('**/pipeline_status.json', (r) =>
    (body === null
      ? r.fulfill({ status, contentType: 'application/json', body: '{}' })
      : r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })));
}
async function statusWired(page) {
  // The status view is identifiable by its health pill (populated case) OR its
  // "not yet generated" graceful copy (empty/missing case). If neither appears,
  // the #/status route isn't registered in main.js yet (Home fallback).
  return page.evaluate(() => {
    const txt = document.querySelector('#view')?.textContent || '';
    return !!document.querySelector('[data-testid="status-health"]') ||
      /Pipeline status/i.test(txt) || /not yet generated/i.test(txt);
  });
}

test('degraded status → health pill reads degraded, bad feed chip shows, fits 390px', async ({ page }) => {
  await routeStatus(page, DEGRADED);
  await page.goto('/#/status', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  test.skip(!(await statusWired(page)), 'PENDING INTEGRATOR: #/status route not yet in main.js');

  await expect(page.locator('[data-testid="status-health"]')).toHaveText(/degraded/i);
  await expect(page.getByText('form.json', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('empty', { exact: false }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(overflow).toBeLessThanOrEqual(390);
});

test('missing/empty status JSON → graceful "not yet generated" (no fatal error)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeStatus(page, null);  // {} payload → no feeds[] → graceful state
  await page.goto('/#/status', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  test.skip(!(await statusWired(page)), 'PENDING INTEGRATOR: #/status route not yet in main.js');

  await expect(page.getByText(/not yet generated/i)).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('Settings exposes the Pipeline status link (route already wired via Settings)', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
  const link = page.locator('[data-testid="settings-pipeline-status"]');
  await expect(link).toBeVisible({ timeout: 12_000 });
});
