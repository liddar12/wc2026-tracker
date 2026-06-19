import { test, expect } from '@playwright/test';

test.describe('Projected bracket + hidden nav', () => {
  test('Projected tab renders the projected bracket (source picker + resolved teams)', async ({ page }) => {
    const errors = [];
    // "Transition was skipped" is a benign View Transitions notice when a
    // re-render interrupts an in-flight transition — not an app error.
    page.on('pageerror', (e) => { if (!/Transition was skipped/i.test(e.message)) errors.push(e.message); });
    await page.goto('/#/projected', { waitUntil: 'domcontentloaded' });

    // defaults to Projected mode with the source/model selector (the image)
    await expect(page.locator('[data-testid="bracket-mode-toggle"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="bracket-mode-projected"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-testid="bracket-projected"]')).toBeVisible();
    await expect(page.locator('[data-testid="bracket-source-select"]')).toBeVisible();

    // switching source stays on /projected (route-aware) and repaints
    await page.locator('[data-testid="bracket-source-select"]').selectOption('dt');
    await expect(page).toHaveURL(/#\/projected/);
    await expect(page.locator('[data-testid="bracket-projected"]')).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('CLICKING the Projected tab opens the bracket (not a redirect to home)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="tab-projected"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="tab-projected"]').click();
    await expect(page).toHaveURL(/#\/projected/);
    await expect(page.locator('[data-testid="bracket-projected"]')).toBeVisible({ timeout: 10_000 });
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
