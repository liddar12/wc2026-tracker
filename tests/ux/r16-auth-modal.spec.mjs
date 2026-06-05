import { test, expect } from '@playwright/test';

// R16 Phase 1 — the auth lightbox + every entry point, on the mobile viewport.
// Covers the four root-caused bugs: no lightbox, barely-works navbar, logout
// not repainting, Settings "Sign in" dead-ending on My Picks.

// The account button's click handler is wired by initToolbarAuth, which runs
// AFTER the data load completes; syncLabel then stamps data-state on the
// button. Waiting for that attribute is the reliable "app is interactive"
// signal (clicking earlier no-ops → flaky).
async function ready(page, url = '/') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="toolbar-account"]'))
    .toHaveAttribute('data-state', /signed-out|guest|signed-in|offline/, { timeout: 15_000 });
}

const ACCOUNT = '[data-testid="toolbar-account"]';
const MODAL = '[data-testid="auth-modal"]';

test.describe('R16 auth modal', () => {
  test('navbar account button opens the centered lightbox with all three actions', async ({ page }) => {
    await ready(page);
    await page.locator(ACCOUNT).click();
    const modal = page.locator(MODAL);
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Create Account' })).toBeVisible();
    await expect(modal.getByRole('button', { name: /Continue as Guest/i })).toBeVisible();
  });

  test('Sign In reveals the username/password form', async ({ page }) => {
    await ready(page);
    await page.locator(ACCOUNT).click();
    const modal = page.locator(MODAL);
    await modal.getByRole('button', { name: 'Sign In' }).click();
    await expect(modal.locator('#comp-username')).toBeVisible();
    await expect(modal.locator('#comp-password')).toBeVisible();
  });

  test('Esc closes, and the close button closes', async ({ page }) => {
    await ready(page);
    const modal = page.locator(MODAL);

    await page.locator(ACCOUNT).click();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    await page.locator(ACCOUNT).click();
    await expect(modal).toBeVisible();
    // ui-ux §2: close button must meet the 44×44 touch-target minimum.
    const box = await modal.locator('.auth-modal-close').boundingBox();
    expect(box.width, 'close button width ≥44').toBeGreaterThanOrEqual(44);
    expect(box.height, 'close button height ≥44').toBeGreaterThanOrEqual(44);
    await modal.locator('.auth-modal-close').click();
    await expect(modal).toHaveCount(0);
  });

  test('Settings "Sign in" opens the modal in place (no nav to My Picks)', async ({ page }) => {
    await ready(page, '/#/settings');
    const btn = page.locator('#settings-go-signin');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();
    const modal = page.locator(MODAL);
    await expect(modal).toBeVisible();
    await expect(modal.locator('#comp-username')).toBeVisible(); // opened on the signin form
    await expect(page).toHaveURL(/#\/settings/);                  // stayed on Settings
  });

  test('guest flow prompts for a name AND repaints the current view (logout/state-change bridge)', async ({ page }) => {
    await ready(page, '/#/my-picks');
    await page.locator(ACCOUNT).click();
    const modal = page.locator(MODAL);
    await modal.getByRole('button', { name: /Continue as Guest/i }).click();

    const handle = page.locator('.auth-handle-overlay');
    await expect(handle).toBeVisible();
    await handle.locator('#auth-handle-input').fill('TestGuest');
    await handle.locator('#auth-handle-ok').click();

    await expect(modal).toHaveCount(0);
    await expect(page.locator('#auth-toolbar-label')).toHaveText(/TestGuest|Guest/);
    // My Picks repainted to the guest card WITHOUT a manual reload — this proves
    // competition:state-change → renderView (the same mechanism logout uses).
    await expect(page.getByText('(guest)')).toBeVisible({ timeout: 10_000 });
  });

  test('no uncaught page errors when loading + opening the modal', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await ready(page);
    await page.locator(ACCOUNT).click();
    await expect(page.locator(MODAL)).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
