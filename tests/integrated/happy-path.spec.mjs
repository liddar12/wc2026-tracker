import { test, expect } from '@playwright/test';

// Asserts PRE-TOURNAMENT (unlocked) funnel behavior — freeze the clock before
// the first kickoff or the lock-disabled submit makes this a time bomb (it
// broke the moment the tournament started on 2026-06-11 19:00Z).
const PRE_TOURNAMENT_MS = Date.parse('2026-06-01T12:00:00Z');

test.describe('Integrated R6 happy path', () => {
  test.beforeEach(async ({ page }) => {
    const offset = PRE_TOURNAMENT_MS - Date.now();
    await page.addInitScript((off) => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + off;
    }, offset);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('wc26.')) localStorage.removeItem(k);
      }
    });
  });

  test('full flow: nav → Play → seed full picks → submit unlocks → podium fires', async ({ page }) => {
    // Play tab is hidden from nav (owner request); route still works by URL.
    await page.goto('/#/play', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });

    // Submit must start disabled
    const submit = page.locator('[data-testid="play-submit"]');
    await expect(submit).toBeDisabled();

    // Seed the rest via localStorage (faster than tapping 12*4 tiles)
    await page.evaluate(() => {
      const letters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
      const groups = {}, thirds = [];
      for (const l of letters) {
        groups[l] = [`${l}1`,`${l}2`,`${l}3`,`${l}4`];
        thirds.push(`${l}3`);
      }
      localStorage.setItem('wc26.grouppicks.local', JSON.stringify({ groups, best_thirds: thirds.slice(0, 8) }));
      const bracket = { picks: {} };
      for (let mn = 73; mn <= 88; mn++) bracket.picks[String(mn)] = { team: `R32_${mn}` };
      for (let mn = 89; mn <= 96; mn++) bracket.picks[String(mn)] = { team: `R16_${mn}` };
      for (let mn = 97; mn <= 100; mn++) bracket.picks[String(mn)] = { team: `QF_${mn}` };
      for (let mn = 101; mn <= 102; mn++) bracket.picks[String(mn)] = { team: `SF_${mn}` };
      bracket.picks['103'] = { team: 'ThirdTeam' };
      bracket.picks['104'] = { team: 'TheChampion' };
      localStorage.setItem('wc26.mybrackets.local', JSON.stringify(bracket));
    });

    // Reload to pick up the seeded picks (Play tab hidden; navigate by URL)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto('/#/play', { waitUntil: 'domcontentloaded' });
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    // Submit opens podium modal
    await submit.click();
    await expect(page.locator('[data-testid="podium-modal"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.pw-podium-sentence')).toContainText('beat');
    // Close podium
    await page.locator('[data-testid="podium-close"]').click();
    await expect(page.locator('[data-testid="podium-modal"]')).toHaveCount(0);
  });

  test('cross-sync: Stage-1 changes reflect in /#/bracket via Live tab', async ({ page }) => {
    await page.goto('/#/play/stage/1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });
    const teams = page.locator('.pw-team-tile');
    await teams.nth(0).click();
    await teams.nth(1).click();
    await teams.nth(2).click();
    await teams.nth(3).click();
    // Switch to Bracket (tab hidden from nav; route still works by URL)
    await page.goto('/#/bracket', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="bracket-mode-toggle"]')).toBeVisible({ timeout: 10_000 });
    // Live mode default — the live tree should still render (no actuals yet, but the slots exist)
    await expect(page.locator('[data-testid="bracket-live"]')).toBeVisible();
  });

  test('reload resumes the funnel where it left off', async ({ page }) => {
    await page.goto('/#/play/stage/1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });
    const tiles = page.locator('.pw-team-tile');
    await tiles.first().click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="play-stage-1"]')).toBeVisible({ timeout: 10_000 });
    // Find any rank=1 tile after reload
    await expect(page.locator('.pw-team-rank').first()).toContainText('1st');
  });
});
