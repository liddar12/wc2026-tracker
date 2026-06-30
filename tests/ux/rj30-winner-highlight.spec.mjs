import { test, expect } from '@playwright/test';

/* rj30-winner-highlight.spec.mjs — RJ30-9d (browser DOM assertion).
 *
 * The winner-highlight + method-tag LOGIC is unit-locked in
 * tests/feature/winner-highlight.test.mjs, but that file's DOM-render block is
 * skipped under node (no document). This Playwright spec closes the gap: it
 * renders a REAL ET/penalty knockout card on the Schedule view (mobile 390×844)
 * and asserts the advancing team carries .is-winner, the loser does not, and the
 * eyebrow shows the en-dash `pens (3–2)` method tag.
 *
 * Fixture: the committed data/actual_results.json already contains a real
 * STATUS_FINAL_PEN row — Netherlands 1–1 Morocco (winner Morocco, shootout 2–3,
 * R32). We drive the live data rather than mutate files, so there is no shared-
 * state churn. The Schedule view deterministically renders a largeMatchCard for
 * every fixture on a day, independent of any "today" reorder logic.
 *
 * Match: kickoff 2026-06-30T01:00:00Z → Eastern-time match day 2026-06-29
 * (schedule-view buckets by ET, UTC-4). */

const SCHEDULE_DATE = '2026-06-29';
const CARD = '[data-testid="large-match-card"][data-team-a="Netherlands"][data-team-b="Morocco"]';

async function openCard(page, url) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const card = page.locator(CARD);
  await expect(card).toBeVisible({ timeout: 15_000 });
  return { card, errors };
}

test('Schedule: ET/pen knockout card highlights the advancing team + shows pens (3–2)', async ({ page }) => {
  const { card, errors } = await openCard(page, `/#/schedule/date/${SCHEDULE_DATE}`);

  // Morocco is side B and went through → .lcard-team-b carries .is-winner.
  await expect(card.locator('.lcard-team-b.is-winner')).toBeVisible();
  // Netherlands (side A) lost the shootout → must NOT be highlighted.
  await expect(card.locator('.lcard-team-a.is-winner')).toHaveCount(0);

  // Method tag in the eyebrow reads the en-dash shootout suffix.
  const eyebrow = card.locator('.lcard-eyebrow');
  await expect(eyebrow).toContainText('pens');
  await expect(eyebrow).toContainText('(3–2)'); // en-dash hi–lo
  await expect(card.locator('.lcard-method')).toContainText('pens (3–2)');

  expect(errors, errors.join('\n')).toHaveLength(0);

  await page.screenshot({ path: 'test-results/rj30-winner-highlight-schedule.png' });
});

test('a regulation FINAL card highlights the higher-score team with an FT tag', async ({ page }) => {
  // Opening day (ET 2026-06-11) has finished group games → FINAL cards with FT.
  await page.goto(`/#/schedule/date/2026-06-11`, { waitUntil: 'domcontentloaded' });
  // Wait for the schedule's card stack to render (data loads async).
  await expect(page.locator('[data-testid="large-match-card"]').first())
    .toBeVisible({ timeout: 15_000 });
  const first = page.locator('[data-testid="large-match-card"][data-mode="final"]').first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await expect(first.locator('.is-winner')).toHaveCount(1);
  await expect(first.locator('.lcard-eyebrow')).toContainText('FINAL');
});
