import { test, expect } from '@playwright/test';

test.describe('Projected bracket + hidden nav', () => {
  test('Projected tab: enhanced tree + stage nav + zoom + confidence', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => { if (!/Transition was skipped/i.test(e.message)) errors.push(e.message); });
    await page.goto('/#/projected', { waitUntil: 'domcontentloaded' });

    // stage nav (GS/R32/.../F) + the bracket tree render
    await expect(page.locator('[data-testid="eb-stage-nav"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible();
    // tree has connector-line matches + at least one confidence badge. Two races
    // guard this: (1) the bracket CONTAINER paints before its matches stream in
    // from the critical feeds, and (2) during a LIVE match the poller re-renders
    // root.innerHTML every ~30s, so even a count() taken right after a passing
    // visibility wait can catch the mid-rebuild instant and see 0. expect.poll
    // retries the COUNT itself through both races until it holds.
    await expect.poll(() => page.locator('.eb-match').count(), { timeout: 15_000 })
      .toBeGreaterThan(20);
    await expect.poll(() => page.locator('.eb-conf').count(), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // GS stage shows the standings → seeding view
    await page.locator('[data-testid="eb-stage-gs"]').click();
    await expect(page.locator('[data-testid="eb-group-seeding"]')).toBeVisible();
    // Auto-wait for the seeding rows to populate (12 groups × ~4 teams ≈ 48). A
    // bare count() raced the post-click re-render and intermittently saw < 21;
    // asserting the 21st row is attached retries until the rows exist.
    await expect(page.locator('.eb-gs-row').nth(20)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/#\/projected/);

    // back to a round + zoom fit (stays on /projected)
    await page.locator('[data-testid="eb-stage-qf"]').click();
    await page.locator('.eb-zoom-btn[data-zoom="fit"]').click();
    await expect(page).toHaveURL(/#\/projected/);
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('CLICKING the Projected tab opens the bracket (not a redirect to home)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="tab-projected"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="tab-projected"]').click();
    await expect(page).toHaveURL(/#\/projected/);
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible({ timeout: 10_000 });
    // must NOT have fallen back to the home view
    await expect(page.locator('.home-hero')).toHaveCount(0);
  });

  test('BR-6 what-if: tap a team to override a winner → reset appears', async ({ page }) => {
    await page.goto('/#/projected', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible({ timeout: 15_000 });
    // Critical-path loading paints the bracket from the CRITICAL feeds, then a
    // couple of re-renders follow within ~1-2s: the DEFERRED feeds stream in, and
    // (during a live match) the live-poller's first tick. Each rebuilds
    // root.innerHTML, swapping the bracket DOM + its delegated tap listener out
    // from under a click landing in that window. Rather than wait a fixed time
    // (the test budget is 15s), retry the whole scan web-first: tap the non-winner
    // of the first OVERRIDABLE (undecided) R32 match, and if a stray re-render ate
    // the tap this pass, toPass re-runs after it settles. An already-overridden
    // match is skipped so a second tap never toggles it back off; a DECIDED match
    // is locked to its real winner and silently ignores the what-if.
    await expect(async () => {
      // Success if an override already stuck (this pass or a prior one — the
      // override is module state that survives re-renders).
      if ((await page.locator('.eb-match[data-overridden]').count()) > 0) return;
      // Scan EVERY round, not just R32: as the tournament advances the earlier
      // rounds become DECIDED (locked to their real winner, no tappable loser),
      // so the first OVERRIDABLE match migrates forward (QF/SF/F). A decided
      // match exposes no `.eb-team.eb-tappable:not(.eb-win)`, so it is skipped
      // naturally; we just need any one undecided match to accept the tap.
      const matches = page.locator('.eb-match');
      const n = await matches.count();
      for (let i = 0; i < n; i++) {
        const m = matches.nth(i);
        if (await m.getAttribute('data-overridden')) continue; // don't toggle it off
        const loser = m.locator('.eb-team.eb-tappable:not(.eb-win)').first();
        if ((await loser.count()) === 0) continue;
        await loser.click();
        if ((await page.locator('.eb-match[data-overridden]').count()) > 0) return; // stuck
      }
      throw new Error('no undecided match accepted a what-if override yet');
    }).toPass({ timeout: 10_000 });
    // an override marker + reset control appear
    await expect(page.locator('.eb-match[data-overridden]').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="eb-reset"]')).toBeVisible();
    // reset clears it
    await page.locator('[data-testid="eb-reset"]').click();
    await expect(page.locator('.eb-match[data-overridden]')).toHaveCount(0);
  });

  test('BR-7: tapping a group team highlights its path in R32', async ({ page }) => {
    await page.goto('/#/projected/stage/gs', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="eb-group-seeding"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('.eb-gs-row.eb-tappable').first().click();
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.eb-team.eb-hl').first()).toBeVisible();
  });

  test('the five low-use tabs are hidden; Projected tab is shown', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="tab-projected"]')).toBeVisible();
    for (const t of ['tab-play', 'tab-bracket', 'tab-pools', 'tab-my-brackets', 'tab-my-picks']) {
      await expect(page.locator(`[data-testid="${t}"]`)).toBeHidden();
    }
  });

  test('Luck check card: descriptive luck rows for the remaining knockout teams', async ({ page }) => {
    // Expected visibility comes from the same data the dev server serves, so the
    // assertion stays correct as the tournament advances (card shows while ≥2
    // named teams still have an unplayed knockout match; hides after the final).
    const { readFileSync } = await import('node:fs');
    const J = (p) => JSON.parse(readFileSync(new URL(`../../data/${p}`, import.meta.url), 'utf8'));
    const sched = J('schedule_full.json');
    const ar = J('actual_results.json');
    const FINAL = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME', 'STATUS_FINAL_AET', 'STATUS_FINAL_PEN']);
    const KO = new Set(['round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final']);
    const placeholder = (s) => typeof s !== 'string' || /^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/.test(s);
    const alive = new Set();
    for (const m of (sched.matches || sched)) {
      if (!KO.has(m.stage) || placeholder(m.team_a) || placeholder(m.team_b)) continue;
      const rec = ar[m.stage]?.[`${m.team_a}__vs__${m.team_b}`] || ar[m.stage]?.[`${m.team_b}__vs__${m.team_a}`];
      if (rec && (FINAL.has(rec.status) || rec.status === undefined)) continue;
      alive.add(m.team_a); alive.add(m.team_b);
    }

    await page.goto('/#/projected', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="eb-bracket"]')).toBeVisible({ timeout: 15_000 });
    const card = page.locator('[data-testid="eb-luck-card"]');
    if (alive.size >= 2) {
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => page.locator('.eb-luck-row').count()).toBeGreaterThanOrEqual(2);
      // the display-only disclaimer is part of the contract
      await expect(card.locator('.eb-luck-note')).toContainText('never adjusts projections');
    } else {
      await expect(card).toHaveCount(0);
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
