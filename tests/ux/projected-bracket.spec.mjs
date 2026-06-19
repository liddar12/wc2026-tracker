import { test, expect } from '@playwright/test';

test.describe('Projected bracket + hidden nav', () => {
  test('Projected view renders a real bracket (podium + rounds) and switches models', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/#/projected', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-testid="pb-podium"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="pb-bracket"]')).toBeVisible();
    // a real projection: at least one round-column header and several matches
    await expect(page.locator('.pb-col-head').first()).toContainText(/Round of 32/);
    expect(await page.locator('.pb-match').count()).toBeGreaterThan(20);
    // champion cell shows an actual team (not TBD)
    await expect(page.locator('[data-testid="pb-podium"] .pb-podium-team').first()).not.toContainText('TBD');

    // model switch re-renders
    const chips = page.locator('.pb-models .pw-model-chip');
    await expect(chips).not.toHaveCount(0);
    await chips.nth(1).click();
    await expect(page.locator('[data-testid="pb-bracket"]')).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
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
