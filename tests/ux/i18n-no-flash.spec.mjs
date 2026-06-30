import { test, expect } from '@playwright/test';

/* i18n-no-flash.spec.mjs — RJ30.1-B (QA-3). Pre-seeds wc26.lang='es' before any
   app code runs and asserts the first localized chrome the user sees is Spanish
   (no flash of English), and that no pageerror fires.

   Wave-2 INTEGRATED: app/main.js awaits initI18n() before the first
   loadData()/render and runs localizeShell(); index.html sets <html lang> from
   wc26.lang in a pre-paint inline script. The PENDING-INTEGRATOR skip guards
   have been removed now that this wiring lands. */

test('es seed → Spanish nav with no English flash, no pageerror', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(() => {
    try { localStorage.setItem('wc26.lang', 'es'); } catch { /* ignore */ }
  });

  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  // <html lang> reflects the seed immediately (pre-paint inline script).
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('es');

  // The schedule tab is Spanish on first stable paint (no English in between):
  // initI18n() gates first render, so the very first label the user sees is es.
  await expect(page.locator('[data-testid="tab-schedule"]')).toHaveText('Calendario');
  // And no English nav label lingers in the shell.
  await expect(page.locator('.tab-bar .tab[data-route="home"]')).not.toHaveText('Home');

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('html lang attribute always tracks the seeded language (a11y / VoiceOver)', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('wc26.lang', 'es'); } catch { /* ignore */ }
  });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('es');
});
