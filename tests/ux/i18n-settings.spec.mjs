import { test, expect } from '@playwright/test';

/* i18n-settings.spec.mjs — RJ30.1-B (QA-2, 390×844). Exercises the Settings
   Language card + tab/shell localization.

   Wave-2 INTEGRATED: the Language card ([data-testid="settings-language"]) is
   wired in app/views/settings-view.js and the nav/title strings are driven by
   t() from app/main.js's localizeShell(). The PENDING-INTEGRATOR skip guards
   have been removed now that the wiring lands. */

// The radio reuses the .settings-radio token whose <input> is display:none
// (visually replaced by the styled label). Clicking the wrapping <label> is the
// real user gesture: it checks the radio and fires `change`. (Playwright's
// .check() refuses a display:none input — this mirrors how a user taps the pill.)
function pickLang(page, value) {
  return page.locator(`.settings-radio:has(input[name="settings-lang"][value="${value}"])`).click();
}

test('Language card toggles to Español, persists wc26.lang, sets <html lang>', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="settings-language"]').waitFor({ state: 'visible' });

  await pickLang(page, 'es');
  await page.waitForTimeout(300);

  const stored = await page.evaluate(() => localStorage.getItem('wc26.lang'));
  expect(stored).toBe('es');
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  expect(htmlLang).toBe('es');
  await expect(page.getByText('Idioma', { exact: false }).first()).toBeVisible();
});

test('tab labels localize to Spanish after switching', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="settings-language"]').waitFor({ state: 'visible' });

  await pickLang(page, 'es');
  await page.waitForTimeout(300);

  await expect(page.locator('[data-testid="tab-schedule"]')).toHaveText('Calendario');
  await expect(page.locator('.tab-bar .tab[data-route="home"]')).toHaveText('Inicio');
});

test('no horizontal overflow at 390px in Spanish', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="settings-language"]').waitFor({ state: 'visible' });

  await pickLang(page, 'es');
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(390);
});

test('Schedule long-date renders a Spanish month after switching', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="settings-language"]').waitFor({ state: 'visible' });

  await pickLang(page, 'es');
  await page.goto('/#/schedule', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const txt = await page.evaluate(() => document.querySelector('#view')?.textContent || '');
  expect(txt).toMatch(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i);
});

test('round-trip back to English restores labels + <html lang="en">', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="settings-language"]').waitFor({ state: 'visible' });

  await pickLang(page, 'es');
  await page.waitForTimeout(200);
  await pickLang(page, 'en');
  await page.waitForTimeout(300);

  await expect(page.locator('[data-testid="tab-schedule"]')).toHaveText('Schedule');
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  expect(htmlLang).toBe('en');
});
