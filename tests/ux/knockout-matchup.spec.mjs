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

test('group matchup still renders its model prediction sections', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mexico', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);
  // Group matches carry per-match model predictions — the grid must still show.
  await expect(page.getByText('Why this prediction')).toBeVisible();
});
