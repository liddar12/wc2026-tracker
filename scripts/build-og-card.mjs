/* build-og-card.mjs — R17: render the static OG share card to a PNG.
 *
 * Renders scripts/og-card.html at 1200×630 via Playwright (chromium) and writes
 * assets/og/share-card.png. Re-run after editing the template:
 *   node scripts/build-og-card.mjs
 *
 * No runtime dependency — this is a one-off build asset. Playwright is already
 * a devDependency (used by the e2e suite).
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, 'og-card.html');
// JPEG: the card is photographic (the ball + gradient), so JPEG is far smaller
// than PNG at indistinguishable quality — keeps the OG image well under 300 KB.
const outPath = join(here, '..', 'assets', 'og', 'share-card.jpg');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
  // Let the webfont/image settle.
  await page.waitForTimeout(300);
  await page.screenshot({ path: outPath, type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log('Wrote', outPath);
} finally {
  await browser.close();
}
