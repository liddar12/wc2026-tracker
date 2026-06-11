import { test, expect } from '@playwright/test';

// These specs assert PRE-TOURNAMENT (unlocked) funnel behavior. The submit
// button is lock-disabled from the first kickoff (deriveLockState →
// group-stage-live), so with the real clock they became time bombs the moment
// the tournament started (2026-06-11 19:00Z). Freeze Date.now() to a
// pre-tournament instant so the funnel is deterministically unlocked.
const PRE_TOURNAMENT_MS = Date.parse('2026-06-01T12:00:00Z');

test.describe('Play funnel — Stage 1 / 2 / 3', () => {
  test.beforeEach(async ({ page }) => {
    const offset = PRE_TOURNAMENT_MS - Date.now();
    await page.addInitScript((off) => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + off;
    }, offset);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Clear any prior local state so the funnel starts empty
    await page.evaluate(() => {
      const keep = new Set(['wc26.theme', 'wc26.app']);
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('wc26.') && !keep.has(k)) localStorage.removeItem(k);
      }
    });
  });

  test('Stage 1: tap teams to rank 1-4, progress chips update', async ({ page }) => {
    await page.goto('/#/play/stage/1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });

    // Group A should be shown by default (no picks yet)
    const card = page.locator('[data-testid^="play-group-"]');
    await expect(card).toBeVisible();
    const teamTiles = page.locator('.pw-team-tile');
    const count = await teamTiles.count();
    expect(count).toBe(4);

    // Tap teams in order; check rank badges appear
    for (let i = 0; i < 4; i++) {
      await teamTiles.nth(i).click();
    }
    // Now all 4 should be ranked
    await expect(teamTiles.locator('.pw-team-rank')).toHaveCount(4);

    // Progress chip A should be green (is-done)
    await expect(page.locator('.pw-group-chip.is-done')).toHaveCount(1);
  });

  test('Stage 1: re-tap clears the rank', async ({ page }) => {
    await page.goto('/#/play/stage/1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });
    const tile = page.locator('.pw-team-tile').first();
    await tile.click();
    await expect(tile.locator('.pw-team-rank')).toHaveText('1st');
    await tile.click();
    await expect(tile.locator('.pw-team-rank')).toHaveCount(0);
  });

  test('Submit button disabled when nothing is picked; what\'s-left lists all three stages', async ({ page }) => {
    await page.goto('/#/play', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-submit-bar"]')).toBeVisible({ timeout: 10_000 });
    const submit = page.locator('[data-testid="play-submit"]');
    await expect(submit).toBeDisabled();
    const checklist = page.locator('.pw-submit-checklist');
    await expect(checklist).toContainText('Stage 1');
    await expect(checklist).toContainText('Stage 2');
    await expect(checklist).toContainText('Stage 3');
  });

  test('Submit button enables only after all three stages complete', async ({ page }) => {
    // Pre-seed full picks via localStorage and load /#/play
    await page.evaluate(() => {
      // Build a complete grouppicks payload + bracket draft
      const letters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
      const groups = {};
      const best_thirds = [];
      for (const l of letters) {
        groups[l] = [`${l}1`, `${l}2`, `${l}3`, `${l}4`];
        best_thirds.push(`${l}3`);
      }
      const picks = { groups, best_thirds: best_thirds.slice(0, 8) };
      localStorage.setItem('wc26.grouppicks.local', JSON.stringify(picks));
      // Fake a complete bracket: pick team_a in every match (real numbers)
      const bracket = { picks: {} };
      for (let mn = 73; mn <= 88; mn++) bracket.picks[String(mn)] = { team: `R32_${mn}` };
      for (let mn = 89; mn <= 96; mn++) bracket.picks[String(mn)] = { team: `R16_${mn}` };
      for (let mn = 97; mn <= 100; mn++) bracket.picks[String(mn)] = { team: `QF_${mn}` };
      for (let mn = 101; mn <= 102; mn++) bracket.picks[String(mn)] = { team: `SF_${mn}` };
      bracket.picks['103'] = { team: 'Third' };
      bracket.picks['104'] = { team: 'Champion' };
      localStorage.setItem('wc26.mybrackets.local', JSON.stringify(bracket));
    });
    await page.goto('/#/play', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-submit-bar"]')).toBeVisible({ timeout: 10_000 });
    const submit = page.locator('[data-testid="play-submit"]');
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await expect(page.locator('.pw-submit-allgreen')).toBeVisible();
  });

  test('Stage chips switch between stages', async ({ page }) => {
    await page.goto('/#/play/stage/1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="stage-chip-2"]').click();
    await expect(page.locator('[data-testid="play-stage-2"]')).toBeVisible();
    await page.locator('[data-testid="stage-chip-3"]').click();
    await expect(page.locator('[data-testid="play-stage-3"]')).toBeVisible();
  });

  test('Stage 3 bracket tree renders 5 columns with sticky round headers', async ({ page }) => {
    // Pre-seed Stage 1+2 so the bracket has resolved seeds
    await page.evaluate(() => {
      const letters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
      const groups = {}, thirds = [];
      for (const l of letters) {
        groups[l] = [`${l}1`,`${l}2`,`${l}3`,`${l}4`];
        thirds.push(`${l}3`);
      }
      localStorage.setItem('wc26.grouppicks.local', JSON.stringify({ groups, best_thirds: thirds.slice(0,8) }));
    });
    await page.goto('/#/play/stage/3', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-3"]')).toBeVisible({ timeout: 10_000 });
    const cols = page.locator('.pw-bracket-col');
    await expect(cols).toHaveCount(5);
  });
});
