import { test, expect } from '@playwright/test';

/* knockout-matchup.spec.mjs — RCA 2026-06-30.
 * Tapping a resolved knockout match (e.g. Netherlands vs Morocco) used to show
 * "Matchup not found": matchup-detail only searched group matchups, and the
 * model-less knockout row threw in describePrediction. This verifies the
 * knockout matchup now opens and renders, while the group matchup keeps its
 * model-prediction sections. */

test('knockout matchup opens (no "Matchup not found") and shows the round + teams', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Netherlands/team_b/Morocco', { waitUntil: 'domcontentloaded' });

  // The two teams must render (data is async — allow load time).
  await expect(page.getByText('Netherlands', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Morocco', { exact: false }).first()).toBeVisible();

  // The failure mode must be gone.
  await expect(page.getByText('Matchup not found')).toHaveCount(0);

  // Knockout rounds show the round name (not "Group ?") and hide the model grid.
  await expect(page.getByText('Round of 32', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Why this prediction')).toHaveCount(0);
});

test('matchup page shows the Luck check (how they got here + disclaimer)', async ({ page }) => {
  // France vs Spain (SF) — both teams always have a group-stage luck profile,
  // so the section renders in every tournament state (pre/live/post match).
  await page.goto('/#/matchup/team_a/France/team_b/Spain', { waitUntil: 'domcontentloaded' });
  const luck = page.locator('[data-testid="matchup-luck"]');
  await expect(luck).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="matchup-luck-France"]')).toBeVisible();
  await expect(page.locator('[data-testid="matchup-luck-Spain"]')).toBeVisible();
  // plain-language contract: a head-to-head sentence + "Nth luckiest of NN teams"
  await expect(page.locator('[data-testid="matchup-luck-headline"]')).toContainText(/luck|breaks|luckier/);
  await expect(luck.locator('.eb-luck-score').first()).toContainText(/luckiest of \d+ teams/);
  await expect(luck.locator('.eb-luck-note')).toContainText('never changes the predictions');
  // A played group fixture has events + stats → the this-match ledger renders.
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="matchup-luck-ledger"]')).toBeVisible({ timeout: 10_000 });
});

test('crowd factor card renders on a match with a known crowd asymmetry', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const crowd = JSON.parse(readFileSync(new URL('../../data/crowd.json', import.meta.url), 'utf8'));
  const pair = Object.keys(crowd).find((k) => k !== '__meta__');
  if (!pair) { test.skip(true, 'no crowd entry configured'); return; }
  const [a, b] = pair.split('__vs__');
  await page.goto(`/#/matchup/team_a/${encodeURIComponent(a)}/team_b/${encodeURIComponent(b)}`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-testid="crowd-factor"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  // both rows present (Model + With crowd) and the transparency disclaimer
  await expect(card.locator('.crowd-row.is-model')).toBeVisible();
  await expect(card.locator('.crowd-row.is-adjusted')).toBeVisible();
  await expect(page.locator('[data-testid="crowd-headline"]')).toContainText(/crowd/i);
  await expect(card.locator('.crowd-note')).toContainText('never feeds the projection');
});

test('group matchup still renders its model prediction sections', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mexico', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);
  // Group matches carry per-match model predictions — the grid must still show.
  await expect(page.getByText('Why this prediction')).toBeVisible();
});
