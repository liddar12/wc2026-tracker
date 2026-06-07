import { test, expect } from '@playwright/test';

// Beta Soccer theme — end-to-end: selecting Beta re-skins the app, injects the
// goal-FAB + The Goal menu, the menu drives the real router, and switching away
// removes it. Light/Dark stay clean. See docs/BETA-THEME-PLAN.md (QA plan).

async function ready(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="toolbar-account"]'))
    .toHaveAttribute('data-state', /signed-out|guest|signed-in|offline/, { timeout: 15_000 });
}

async function selectTheme(page, value) {
  await ready(page, '/#/settings');
  // the native radio is visually hidden behind a styled .settings-radio label;
  // click the label so the real change handler fires.
  await page.locator(`.settings-radio:has(input[value="${value}"])`).click();
  await expect(page.locator(`input[name="settings-theme"][value="${value}"]`)).toBeChecked();
}

test('selecting Beta re-skins the app and shows the goal-FAB', async ({ page }) => {
  await selectTheme(page, 'beta');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'beta');
  await expect(page.locator('[data-testid="beta-goal-fab"]')).toBeVisible({ timeout: 5_000 });
  // token re-bind took effect: app background is the dark ink, not the light bg.
  const bg = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(13, 17, 23)'); // #0D1117
});

test('The Goal menu opens, routes via the real router, and closes', async ({ page }) => {
  await selectTheme(page, 'beta');
  await page.locator('[data-testid="beta-goal-fab"]').click();
  const menu = page.locator('[data-testid="beta-goalmenu"]');
  await expect(menu).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('body')).toHaveClass(/menu-open/);

  // navigate to Golden Boot via a nav chip
  await menu.locator('.navchip[data-route="golden-boot"]').click();
  await page.waitForURL(/#\/golden-boot/, { timeout: 5_000 });
  // menu closed itself after navigating
  await expect(page.locator('body')).not.toHaveClass(/menu-open/);
});

test('Escape closes The Goal menu', async ({ page }) => {
  await selectTheme(page, 'beta');
  await page.locator('[data-testid="beta-goal-fab"]').click();
  await expect(page.locator('body')).toHaveClass(/menu-open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/menu-open/);
});

test('switching back to Light removes The Goal nav and clears the skin', async ({ page }) => {
  await selectTheme(page, 'beta');
  await expect(page.locator('[data-testid="beta-goal-fab"]')).toBeVisible();
  await selectTheme(page, 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('[data-testid="beta-goal-fab"]')).toBeHidden();
});

test('no uncaught errors or Beta-file console errors while using the theme', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // pre-existing network noise (no Supabase/flags in the static test server)
    // is out of scope; guard our own surface.
    if (/beta-nav|goalmenu|theme\.js|data-theme/i.test(t)) errors.push(`console: ${t}`);
  });
  await selectTheme(page, 'beta');
  await page.locator('[data-testid="beta-goal-fab"]').click();
  await page.locator('[data-testid="beta-goalmenu"] .navchip[data-route="matches"]').click();
  await page.waitForURL(/#\/match/, { timeout: 5_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
