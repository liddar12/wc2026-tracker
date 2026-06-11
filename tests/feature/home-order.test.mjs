/* home-order.test.mjs — tournament-mode home section order (owner spec):
   Your team → Today's matches → Don't miss → Full schedule → Recent results
   → Jump to → Live Elo movers. Hero + Play CTA on top; market movers + the
   account slot follow the listed sequence. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app/views/home-view.js', import.meta.url), 'utf8');

test('renderHome appends sections in the tournament-mode order', () => {
  const body = src.slice(src.indexOf('export function renderHome'), src.indexOf('function renderHero'));
  const order = [
    'renderHero',
    'renderPlayCta',
    'renderFavoriteTeamSection',   // Your team
    'renderFavKalshiCard',         // (rides with Your team)
    'renderTodaySection',          // Today's match cards
    'renderMatchOfTheDayChip',     // Don't miss
    'renderFullScheduleCard',      // Full schedule
    'renderRecentSection',         // Recent results
    'renderQuickLinks',            // Jump to
    'renderEloMoversSection',      // Live Elo movers
    'renderMoversSection',         // market movers (unlisted → after)
    'renderAuthSlot',              // account (unlisted → last)
  ];
  let last = -1;
  for (const fn of order) {
    const i = body.indexOf(fn);
    assert.ok(i !== -1, `${fn} is rendered`);
    assert.ok(i > last, `${fn} comes after ${order[order.indexOf(fn) - 1] || 'start'}`);
    last = i;
  }
});

test('Full schedule is its own card; Today head no longer carries the CTA', () => {
  assert.match(src, /function renderFullScheduleCard/, 'standalone card exists');
  const today = src.slice(src.indexOf('function renderTodaySection'), src.indexOf('function renderFullScheduleCard'));
  // The schedule BUTTON moved out (a code comment may still mention it by name).
  assert.ok(!today.includes('data-go="schedule"'), 'CTA button removed from the Today heading card');
});
