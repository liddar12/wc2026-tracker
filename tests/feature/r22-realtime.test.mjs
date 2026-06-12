/* r22-realtime.test.mjs — June-12 real-time batch:
   1) client-side ESPN live merge (scores + clock, 0-0 at kickoff, no regression
      of FINAL records)
   2) recent results show FINAL games only (scheduled 0-0 stubs polluted/top-sorted)
   3) card eyebrow moved off the banner gradient (ADA contrast)
   4) injuries page gains card suspensions
   5) live poller: fast ESPN lane + periodic full refresh */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeLiveScores } from '../../app/live-scores.js';
import { actualForCard } from '../../app/components/large-match-card.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

function freshData() {
  return {
    scheduleFull: [
      { match_id: 'Mexico__vs__South Africa', stage: 'group', team_a: 'Mexico', team_b: 'South Africa', kickoff_utc: '2026-06-11T19:00:00Z' },
      { match_id: 'Korea Republic__vs__Czechia', stage: 'group', team_a: 'Korea Republic', team_b: 'Czechia', kickoff_utc: '2026-06-12T02:00:00Z' },
    ],
    actualResults: {
      group_stage: {
        'Mexico__vs__South Africa': { score_a: 2, score_b: 0, status: 'STATUS_FULL_TIME' },
      },
    },
  };
}

test('kickoff: live 0-0 merges immediately and renders as LIVE with the clock', () => {
  const data = freshData();
  const board = [
    { teams: { 'Korea Republic': 0, 'Czechia': 0 }, status: 'STATUS_IN_PROGRESS', minute: "3'" },
  ];
  const changed = mergeLiveScores(data, board);
  assert.equal(changed, 1);
  const rec = data.actualResults.group_stage['Korea Republic__vs__Czechia'];
  assert.equal(rec.score_a, 0);
  assert.equal(rec.status, 'STATUS_IN_PROGRESS');
  assert.equal(rec.minute, "3'");
  // and the card lookup surfaces it as a live 0-0 with the game clock
  const found = actualForCard(data.actualResults, data.scheduleFull[1]);
  assert.equal(found.mode, 'live');
  assert.deepEqual({ a: found.actual.score_a, b: found.actual.score_b }, { a: 0, b: 0 });
  assert.equal(found.actual.minute, "3'");
});

test('live merge never regresses a FINAL record to in-progress', () => {
  const data = freshData();
  const board = [
    { teams: { Mexico: 1, 'South Africa': 0 }, status: 'STATUS_IN_PROGRESS', minute: "60'" },
  ];
  mergeLiveScores(data, board);
  const rec = data.actualResults.group_stage['Mexico__vs__South Africa'];
  assert.equal(rec.score_a, 2, 'final 2-0 stands');
  assert.equal(rec.status, 'STATUS_FULL_TIME');
});

test('live merge orients flipped ESPN ordering to the schedule row', () => {
  const data = freshData();
  delete data.actualResults.group_stage['Mexico__vs__South Africa'];
  const board = [
    { teams: { 'South Africa': 1, Mexico: 3 }, status: 'STATUS_IN_PROGRESS', minute: "80'" },
  ];
  mergeLiveScores(data, board);
  const rec = data.actualResults.group_stage['Mexico__vs__South Africa'];
  assert.equal(rec.score_a, 3, 'team_a (Mexico) gets Mexico goals');
  assert.equal(rec.score_b, 1);
});

test('recent results filter to FINAL records only', () => {
  const s = read('app/views/home-view.js');
  const section = s.slice(s.indexOf('function renderRecentSection'));
  assert.match(section, /isFinalResultRecord\(rec\)/, 'scheduled/in-progress stubs excluded');
});

test('card eyebrow sits on white below the venue (ADA contrast)', () => {
  const c = read('app/components/large-match-card.js');
  const meta = c.indexOf('lcard-meta');
  const eyebrow = c.indexOf('lcard-eyebrow-below');
  assert.ok(meta !== -1 && eyebrow > meta, 'eyebrow markup comes after the venue/meta line');
  const css = read('app/styles.css');
  // (window widened: an explanatory comment sits between the selector and the rule)
  assert.match(css, /\.lcard-body[\s\S]{0,400}margin-top: 0;/, 'body no longer overlaps the banner');
  assert.ok(!/\.lcard-body[\s\S]{0,400}margin-top: -32px/.test(css), 'the -32px overlap is gone');
});

test('injuries page lists card suspensions with the match they miss', () => {
  const v = read('app/views/injuries-view.js');
  assert.match(v, /function suspensionsFromEvents/, 'suspension derivation exists');
  assert.match(v, /red card/, 'reds covered');
  assert.match(v, /accumulated/, 'yellow accumulation covered');
  assert.match(v, /misses/, 'shows which match is missed');
  assert.match(v, /dataset\.testid = 'suspensions'/, 'rendered section'); // set via dataset property
});

test('live poller: fast ESPN lane every tick + periodic full refresh', () => {
  const p = read('app/live-poller.js');
  assert.match(p, /fetchEspnLive/, 'direct ESPN polling');
  assert.match(p, /mergeLiveScores/, 'merges into in-memory data');
  assert.match(p, /FULL_REFRESH_EVERY/, 'periodic full feed refresh retained');
});

test('June-12 follow-ups: clock strip, home venue label, cron queueing, fresh JS', () => {
  // ESPN displayClock arrives as "26'" — strip the apostrophe (card adds one).
  const ls = read('app/live-scores.js');
  assert.match(ls, /replace\(\/'\+\$\/, ''\)/, 'minute apostrophe stripped');
  // Home cards show the real venue name, not the raw id ("bmo_field").
  const hv = read('app/views/home-view.js');
  assert.match(hv, /venue_label: `\$\{venue\.name\}, \$\{venue\.city\}`/, 'home enriches venue label');
  // Live cron queues instead of canceling (starvation dropped commits to ~2h).
  const lu = read('.github/workflows/live_update.yml');
  assert.match(lu, /group: live-update[\s\S]{0,500}cancel-in-progress: false/, 'live cron queues');
  assert.ok(!/run:\s*python\s+scripts\/scrape_kalshi\.py/.test(lu), 'kalshi off the live cycle');
  // Deploys reach open tabs in minutes, not a day.
  const h = read('_headers');
  assert.match(h, /\/app\/\*\n  Cache-Control: public, max-age=120, stale-while-revalidate=600/, 'short app-code SWR');
});
