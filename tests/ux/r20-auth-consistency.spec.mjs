import { test, expect } from '@playwright/test';

// R20: every "Sign in" affordance should open the R16 auth modal. Pools is the
// outlier (RC3) — it routes to My Picks instead. This spec reproduces that.
async function ready(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="toolbar-account"]'))
    .toHaveAttribute('data-state', /signed-out|guest|signed-in|offline/, { timeout: 15_000 });
}

test('RC3 repro: Pools "Sign in" should open the auth modal (currently routes to My Picks)', async ({ page }) => {
  await ready(page, '/#/pools');
  const btn = page.locator('#pools-signin');
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  // Expected (post-fix): the centered auth modal opens.
  await expect(page.locator('[data-testid="auth-modal"]')).toBeVisible({ timeout: 5_000 });
});

test('control: Settings "Sign in" DOES open the modal (proves the inconsistency is Pools-specific)', async ({ page }) => {
  await ready(page, '/#/settings');
  await page.locator('#settings-go-signin').click();
  await expect(page.locator('[data-testid="auth-modal"]')).toBeVisible({ timeout: 5_000 });
});
