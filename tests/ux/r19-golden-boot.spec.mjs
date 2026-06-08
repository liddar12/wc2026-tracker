import { test, expect } from '@playwright/test';

test.describe('Golden Awards (Boot · Ball · Glove · Young)', () => {
  test('Jump-to tile on Home opens the Golden Awards section', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const tile = page.locator('[data-go="golden-awards"]');
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await tile.click();
    await expect(page).toHaveURL(/#\/golden-awards/);
    await expect(page.locator('[data-testid="gb-odds"]')).toBeVisible({ timeout: 15_000 });
  });

  test('Boot tab (incl. #/golden-boot alias) lists ranked contenders + an elite striker', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/#/golden-boot', { waitUntil: 'domcontentloaded' });
    const list = page.locator('[data-testid="gb-odds-list"]');
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list.locator('li')).not.toHaveCount(0);
    await expect(list).toContainText(/Mbappe|Kane|Haaland|Olmo/);
    await expect(list.locator('li').first()).toContainText('%');
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('award tabs switch the model (Glove shows a goalkeeper)', async ({ page }) => {
    await page.goto('/#/golden-awards?award=glove', { waitUntil: 'domcontentloaded' });
    const list = page.locator('[data-testid="gb-odds-list"]');
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list).toContainText(/Martinez|Maignan|Costa|Alisson|Raya|Donnarumma/);
    // and the Ball tab renders a different field of contenders
    await page.goto('/#/golden-awards?award=ball', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="gb-odds-list"]').locator('li')).not.toHaveCount(0);
  });

  test('back button returns to Home', async ({ page }) => {
    await page.goto('/#/golden-awards', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#gb-back')).toBeVisible({ timeout: 15_000 });
    await page.locator('#gb-back').click();
    await expect(page).toHaveURL(/#\/home|\/$|#\/$/);
  });
});
