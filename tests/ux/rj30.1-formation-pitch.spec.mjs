import { test, expect } from '@playwright/test';

/* rj30.1-formation-pitch.spec.mjs — RJ30.1 Item 1 (iPhone 390×844).
 *
 * STRUCTURE/DOM assertions only — visual styling lands in Wave 2. We assert the
 * pitch renders 11 tokens, the A/B toggle swaps the visible pitch, the pre-match
 * fixture shows the TBA copy (no broken empty pitch), and there is no horizontal
 * overflow at 390px. */

const lineupsSection = (page) =>
  page.locator('details.lineups-section', { has: page.locator('h2', { hasText: 'Lineups' }) });

test('played group match → pitch renders 11 tokens, toggle swaps team', async ({ page }) => {
  // Mexico (4-1-4-1) vs South Africa (5-3-2) — both lineups present in data.
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);

  const sec = lineupsSection(page);
  await expect(sec).toBeVisible({ timeout: 10_000 });

  // Team A's pitch is shown first; the visible panel has 11 player tokens.
  const visiblePanel = page.locator('.fp-panel:not([hidden])');
  await expect(visiblePanel.locator('[data-testid="formation-pitch"] .fp-player')).toHaveCount(11);

  // Toggle to team B and confirm the now-visible panel also has 11 tokens.
  const toggleB = page.locator('[data-testid="fp-toggle-b"]');
  await expect(toggleB).toBeVisible();
  await toggleB.click();
  await expect(page.locator('[data-testid="fp-toggle-b"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.fp-panel:not([hidden]) [data-testid="formation-pitch"] .fp-player')).toHaveCount(11);
});

test('player tokens carry a full-name aria-label and a surname label', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  const firstToken = page.locator('.fp-panel:not([hidden]) [data-testid="formation-pitch"] .fp-player').first();
  await expect(firstToken).toBeVisible({ timeout: 10_000 });
  const aria = await firstToken.getAttribute('aria-label');
  expect(aria && aria.length).toBeTruthy();
  await expect(firstToken.locator('.fp-name')).toHaveText(/\S/);
});

test('no horizontal overflow at 390px', async ({ page }) => {
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="formation-pitch"]').first()).toBeVisible({ timeout: 10_000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('reduced-motion: no transition on the player token', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/#/matchup/team_a/Mexico/team_b/South%20Africa', { waitUntil: 'domcontentloaded' });
  const token = page.locator('.fp-panel:not([hidden]) [data-testid="formation-pitch"] .fp-player').first();
  await expect(token).toBeVisible({ timeout: 10_000 });
  const td = await token.evaluate((el) => getComputedStyle(el).transitionDuration);
  // Under reduced-motion no transition should run (default or media-query forced 0s).
  expect(td.split(',').every((p) => p.trim() === '0s')).toBe(true);
  await ctx.close();
});

test('formation pitch never renders a broken/partial XI', async ({ page }) => {
  // Spain vs Austria was an unplayed R32 fixture when this was written and
  // asserted the pre-match "TBA" empty state. That state is transient: as the
  // tournament advances a fixture moves pre-match → lineup posted → played, and
  // a snapshot may show a played match with no lineup cell at all — so neither
  // the "TBA" copy nor a full XI is guaranteed for any pinned fixture. The
  // durable invariant is that the pitch is NEVER a partial/broken XI: the
  // visible panel draws either zero tokens (no lineup) or a complete 11.
  await page.goto('/#/matchup/team_a/Spain/team_b/Austria', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Matchup not found')).toHaveCount(0);
  const sec = lineupsSection(page);
  await expect(sec).toBeVisible({ timeout: 10_000 });
  const n = await page.locator('.fp-panel:not([hidden]) [data-testid="formation-pitch"] .fp-player').count();
  expect([0, 11]).toContain(n);
});
