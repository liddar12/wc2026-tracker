import { test, expect } from '@playwright/test';

const EVERYONE = '00000000-0000-0000-0000-0000000e1e7e';

test.describe('R18 pool standings', () => {
  test('the standings route renders a standings view (not My Brackets)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/#/standings/id/${EVERYONE}`, { waitUntil: 'domcontentloaded' });

    const view = page.locator('[data-testid="pool-standings"]');
    await expect(view).toBeVisible({ timeout: 15_000 });
    // header shows the pool name
    await expect(page.getByRole('heading', { name: 'Everyone' })).toBeVisible();
    // signed-out (no Supabase session in the test) → a sign-in affordance,
    // NOT the My Brackets bracket builder.
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('[data-testid="my-brackets-tree"]')).toHaveCount(0);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('Pools → Discover tab renders so pools are tappable', async ({ page }) => {
    await page.goto('/#/pools', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Discover' })).toBeVisible({ timeout: 15_000 });
    // back button on the standings view returns to Pools (smoke the wiring)
    await page.goto(`/#/standings/id/${EVERYONE}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#standings-back')).toBeVisible({ timeout: 15_000 });
    await page.locator('#standings-back').click();
    await expect(page).toHaveURL(/#\/pools/);
  });
});
