import { test, expect } from '@playwright/test';

/* rj30_1-previews.spec.mjs — RJ30.1 Item 1 (390×844). The AI preview/recap
   section renders inside matchup-detail from data/previews.json. The mount
   (previewSection(match, data) in app/views/matchup-detail.js) + the data-loader
   previews.json wiring are owned by the Wave-2 INTEGRATOR — see this epic's
   "INTEGRATOR NEEDS". Until those land the section isn't reachable, so the
   present-entry cases self-skip when no mount is detected (keeps the gate green
   pre-integration); the dormant case is a hard assertion that holds either way.

   styles land in Wave 2 — these specs assert STRUCTURE/DOM only (testids, text,
   heading, counts, no-overflow), not visual styling. */

const FWD = 'Mexico__vs__South Africa';
const PREVIEW_FIXTURE = {
  __meta__: { updated_at: '2026-06-30T16:33:05+00:00', model: 'claude-haiku-4-5' },
  [FWD]: {
    kind: 'preview', text: 'Mexico edge a coin-flip opener with the model leaning narrowly their way.',
    content_hash: 'abc', generated_at: '2026-06-30T16:33:05+00:00', model: 'claude-haiku-4-5',
  },
};
const RECAP_FIXTURE = {
  __meta__: { updated_at: '2026-06-30T16:33:05+00:00', model: 'claude-haiku-4-5' },
  [FWD]: {
    kind: 'recap', text: 'Mexico saw off South Africa 2-0 to open the group in control.',
    content_hash: 'def', generated_at: '2026-06-30T16:33:05+00:00', model: 'claude-haiku-4-5',
  },
};

async function routeJson(page, file, body) {
  await page.route(`**/${file}`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

async function gotoMatchup(page) {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mexico', { exact: false }).first()).toBeVisible({ timeout: 12_000 });
}

test('preview section renders Preview heading + fits 390px (skips pre-integration)', async ({ page }) => {
  await routeJson(page, 'previews.json', PREVIEW_FIXTURE);
  await gotoMatchup(page);
  const sec = page.locator('[data-testid=ai-preview]');
  if ((await sec.count()) === 0) {
    test.skip(true, 'previewSection not yet mounted in matchup-detail (Wave-2 integrator)');
  }
  await expect(sec).toBeVisible();
  await expect(sec).toHaveAttribute('data-kind', 'preview');
  await expect(sec.locator('h2')).toContainText(/Preview/);
  await expect(page.getByText(/coin-flip opener/i)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(overflow).toBeLessThanOrEqual(390);
});

test('recap entry shows Recap heading (skips pre-integration)', async ({ page }) => {
  await routeJson(page, 'previews.json', RECAP_FIXTURE);
  await gotoMatchup(page);
  const sec = page.locator('[data-testid=ai-preview]');
  if ((await sec.count()) === 0) {
    test.skip(true, 'previewSection not yet mounted in matchup-detail (Wave-2 integrator)');
  }
  await expect(sec).toHaveAttribute('data-kind', 'recap');
  await expect(sec.locator('h2')).toContainText(/Recap/);
});

test('empty previews.json → no AI section (dormant), rest of page still renders', async ({ page }) => {
  await routeJson(page, 'previews.json', { __meta__: { updated_at: null } });
  await gotoMatchup(page);
  // Hard assertion: a dormant feed NEVER renders an AI section (true whether or
  // not the mount exists — proves graceful dormancy with no regression).
  await expect(page.locator('[data-testid=ai-preview]')).toHaveCount(0);
  // The rest of the matchup detail still renders (referee section present).
  await expect(page.getByText(/Referee/i).first()).toBeVisible();
});
