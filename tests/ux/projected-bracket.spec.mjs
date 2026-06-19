import { test, expect } from '@playwright/test';

test.describe('Projected bracket + hidden nav', () => {
  test('Projected tab: enhanced tree + stage nav + zoom + confidence', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => { if (!/Transition was skipped/i.test(e.message)) errors.push(e.message); });
    await page.goto('/#/projected', { waitUntil: 'domcontentloaded' });

    // stage nav (GS/R32/.../F) + the bracket tree render
    await expect(page.locator('[data-testid="eb-stage-nav"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible();
    // tree has connector-line matches + at least one confidence badge
    expect(await page.locator('.eb-match').count()).toBeGreaterThan(20);
    expect(await page.locator('.eb-conf').count()).toBeGreaterThan(0);

    // GS stage shows the standings → seeding view
    await page.locator('[data-testid="eb-stage-gs"]').click();
    await expect(page.locator('[data-testid="eb-group-seeding"]')).toBeVisible();
    expect(await page.locator('.eb-gs-row').count()).toBeGreaterThan(20); // 12 groups × ~4 teams
    await expect(page).toHaveURL(/#\/projected/);

    // back to a round + zoom fit (stays on /projected)
    await page.locator('[data-testid="eb-stage-qf"]').click();
    await page.locator('.eb-zoom-btn[data-zoom="fit"]').click();
    await expect(page).toHaveURL(/#\/projected/);
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('CLICKING the Projected tab opens the bracket (not a redirect to home)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="tab-projected"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="tab-projected"]').click();
    await expect(page).toHaveURL(/#\/projected/);
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible({ timeout: 10_000 });
    // must NOT have fallen back to the home view
    await expect(page.locator('.home-hero')).toHaveCount(0);
  });

  test('the five low-use tabs are hidden; Projected tab is shown', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="tab-projected"]')).toBeVisible();
    for (const t of ['tab-play', 'tab-bracket', 'tab-pools', 'tab-my-brackets', 'tab-my-picks']) {
      await expect(page.locator(`[data-testid="${t}"]`)).toBeHidden();
    }
  });

  test('hidden in-content entry points (Home Play CTA / quick links) are gone', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.home-hero')).toBeVisible({ timeout: 10_000 });
    // no visible entry point to a hidden route
    await expect(page.locator('[data-go="play"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-go="pools"]:visible')).toHaveCount(0);
    await expect(page.locator('#home-play-cta-btn')).toHaveCount(0);
  });
});
