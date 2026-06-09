import { test, expect } from '@playwright/test';

// Regression: the home "Your team" card overlapped the team name onto the action
// buttons (the 3 buttons starved the name cell). Fix stacks actions below the
// name on phones + clamps the name. This guards against the name ever colliding
// with the buttons again — for short AND long team names.

async function setFavAndOpen(page, team) {
  await page.addInitScript((t) => localStorage.setItem('wc26.favoriteTeam', t), team);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.fav-current')).toBeVisible({ timeout: 15_000 });
}

function geometry(page) {
  return page.evaluate(() => {
    const n = document.querySelector('.fav-name');
    const a = document.querySelector('.fav-actions');
    const nb = n.getBoundingClientRect();
    const ab = a.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      overlap: nb.right > ab.left + 1 && nb.top < ab.bottom - 1 && nb.bottom > ab.top + 1,
      ellipsis: cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap',
      nameOverflowsBox: n.scrollWidth > n.clientWidth + 1,
    };
  });
}

for (const team of ['England', 'USA', 'Korea Republic', 'Bosnia and Herzegovina']) {
  test(`Your team card: "${team}" never overlaps the action buttons (phone)`, async ({ page }) => {
    await setFavAndOpen(page, team);
    const g = await geometry(page);
    expect(g.overlap, `${team} name overlaps actions`).toBe(false);
    expect(g.ellipsis, 'name is ellipsis-clamped').toBe(true);
    // with the clamp, the name text is never allowed to spill out of its box
    expect(g.nameOverflowsBox, 'name text overflows its box').toBe(false);
  });
}
