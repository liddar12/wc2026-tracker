/* parlay.test.mjs — BR-8 Parlay of the Day. Three 3-leg parlays from today's
   matches (Most likely / Safe-diversified / Best value), model+market blended. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parlayOfTheDay, dailyLegs } from '../../app/components/parlay.js';

function dataToday() {
  const now = new Date().toISOString();
  return {
    scheduleFull: [
      { match_id: 'USA__vs__Paraguay', team_a: 'USA', team_b: 'Paraguay', kickoff_utc: now },
      { match_id: 'Spain__vs__Japan', team_a: 'Spain', team_b: 'Japan', kickoff_utc: now },
      { match_id: 'Brazil__vs__Haiti', team_a: 'Brazil', team_b: 'Haiti', kickoff_utc: now },
    ],
    groupMatchups: { X: { matches: [
      { team_a: 'USA', team_b: 'Paraguay', probabilities: { team_a_wins: 62, draw: 22, team_b_wins: 16 } },
      { team_a: 'Spain', team_b: 'Japan', probabilities: { team_a_wins: 70, draw: 18, team_b_wins: 12 } },
      { team_a: 'Brazil', team_b: 'Haiti', probabilities: { team_a_wins: 80, draw: 13, team_b_wins: 7 } },
    ] } },
    xg: {
      a: { team_a: 'USA', team_b: 'Paraguay', team_a_xg: 1.6, team_b_xg: 0.9 },
      b: { team_a: 'Spain', team_b: 'Japan', team_a_xg: 2.0, team_b_xg: 1.0 },
      c: { team_a: 'Brazil', team_b: 'Haiti', team_a_xg: 2.4, team_b_xg: 0.6 },
    },
    markets: { match_outcomes: { 'USA__vs__Paraguay': { team_a: 'USA', team_b: 'Paraguay', team_a_prob: 0.55, draw_prob: 0.25, team_b_prob: 0.20 } } },
    players: [{ name: 'Pulisic', team: 'USA', position: 'FWD', scoring: 88 }],
  };
}

test('builds three 3-leg parlays from today’s games', () => {
  const r = parlayOfTheDay(dataToday());
  assert.ok(r, 'returns a result');
  assert.equal(r.parlays.length, 3, 'Most likely / Safe / Best value');
  for (const p of r.parlays) {
    assert.equal(p.legs.length, 3, `${p.name} has 3 legs`);
    // one leg per match (distinct) → honest combined probability
    assert.equal(new Set(p.legs.map((l) => l.mid)).size, 3, `${p.name} legs are distinct matches`);
    // combined probability = product of legs; odds = 1/combined
    const prod = p.legs.reduce((a, l) => a * l.prob, 1);
    assert.ok(Math.abs(p.combinedProb - prod) < 1e-9, 'combined = product of legs');
    assert.ok(Math.abs(p.odds - 1 / prod) < 1e-9, 'odds = 1/combined');
  }
});

test('Safe parlay diversifies across bet types', () => {
  const safe = parlayOfTheDay(dataToday()).parlays.find((p) => /Safe/.test(p.name));
  assert.equal(new Set(safe.legs.map((l) => l.type)).size, 3, 'three distinct bet types');
});

test('blends market into the moneyline (USA 62% model + 55% market → ~59%)', () => {
  const r = parlayOfTheDay(dataToday());
  const usaMl = r.parlays.flatMap((p) => p.legs).find((l) => l.type === 'Moneyline' && /USA/.test(l.selection));
  assert.ok(usaMl && usaMl.prob > 0.57 && usaMl.prob < 0.61, `blended ~59% (got ${usaMl?.prob})`);
});

test('no games today → renders nothing (null)', () => {
  assert.equal(parlayOfTheDay({ scheduleFull: [] }), null);
});

test('prefers near-real-time live odds (ESPN/DraftKings) over the hourly cron', () => {
  const d = dataToday();
  d.liveOdds = {
    'USA__vs__Paraguay': { wdl: { a: 0.70, d: 0.18, b: 0.12, home: 'USA', away: 'Paraguay' }, ou: { line: 3.5, over: 0.6 }, provider: 'DraftKings' },
    __ts: new Date().toISOString(),
  };
  const r = parlayOfTheDay(d);
  assert.ok(r.live, 'flagged as live');
  // check the full candidate pool (selected parlays may not surface every leg)
  const pool = dailyLegs(d);
  const usaMl = pool.find((l) => l.type === 'Moneyline' && /USA/.test(l.selection) && l.mid === 'USA__vs__Paraguay');
  assert.ok(usaMl && usaMl.prob > 0.63, `ML blended toward live 0.70 (got ${usaMl?.prob})`); // (0.62 model + 0.70 live)/2
  assert.ok(pool.some((l) => l.type === 'Total goals' && l.mid === 'USA__vs__Paraguay' && /3\.5/.test(l.selection)), 'uses the live O/U line (3.5), not the model 2.5');
});

test('uses multi-book consensus (API-Football) over the hourly Kalshi feed', () => {
  const d = dataToday();
  // Kalshi has USA at 0.55; consensus (sharper) has USA at 0.72 + Over2.5 at 0.70.
  d.consensusOdds = { source: 'api-football', match_outcomes: {
    'USA__vs__Paraguay': { team_a: 'USA', team_b: 'Paraguay', team_a_prob: 0.72, draw_prob: 0.18, team_b_prob: 0.10, over25: 0.70, books: 9 },
  } };
  const pool = dailyLegs(d);
  const usaMl = pool.find((l) => l.type === 'Moneyline' && /USA/.test(l.selection) && l.mid === 'USA__vs__Paraguay');
  // (0.62 model + 0.72 consensus)/2 = 0.67 — NOT the (0.62+0.55 Kalshi)/2 = 0.585 blend.
  assert.ok(usaMl && usaMl.prob > 0.65 && usaMl.prob < 0.69, `blended toward consensus (got ${usaMl?.prob})`);
  const usaOu = pool.find((l) => l.type === 'Total goals' && l.mid === 'USA__vs__Paraguay');
  assert.ok(usaOu && /Over 2\.5/.test(usaOu.selection) && Math.abs(usaOu.prob - 0.70) < 1e-9, `consensus Over2.5 0.70 (got ${usaOu?.selection} ${usaOu?.prob})`);
});

test('live odds (near-real-time) still win over consensus when both present', () => {
  const d = dataToday();
  d.consensusOdds = { match_outcomes: { 'USA__vs__Paraguay': { team_a: 'USA', team_b: 'Paraguay', team_a_prob: 0.72, draw_prob: 0.18, team_b_prob: 0.10 } } };
  d.liveOdds = { 'USA__vs__Paraguay': { wdl: { a: 0.50, d: 0.28, b: 0.22, home: 'USA', away: 'Paraguay' }, provider: 'DraftKings' }, __ts: new Date().toISOString() };
  const usaMl = dailyLegs(d).find((l) => l.type === 'Moneyline' && /USA/.test(l.selection) && l.mid === 'USA__vs__Paraguay');
  // live 0.50 wins → (0.62 + 0.50)/2 = 0.56, not the consensus-blended 0.67.
  assert.ok(usaMl && usaMl.prob > 0.54 && usaMl.prob < 0.58, `live beats consensus (got ${usaMl?.prob})`);
});

test('near-real-time wiring: poller fetches live odds; CSP already allows ESPN', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('../../', import.meta.url);
  const rd = (p) => readFileSync(new URL(p, root), 'utf8');
  assert.match(rd('app/live-poller.js'), /fetchLiveOdds/, 'poller pulls live odds on the slow tick');
  assert.match(rd('app/live-odds.js'), /site\.api\.espn\.com/, 'odds from ESPN (open CORS, already used for scores)');
  assert.match(rd('_headers'), /site\.api\.espn\.com/, 'CSP connect-src already allows ESPN');
});

test('schedule view + parlay carry the not-betting-advice disclaimer', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('../../', import.meta.url);
  const sv = readFileSync(new URL('app/views/schedule-view.js', root), 'utf8');
  assert.match(sv, /renderParlayOfDay\(data\)/, 'parlay appended to schedule');
  const pl = readFileSync(new URL('app/components/parlay.js', root), 'utf8');
  assert.match(pl, /not betting advice/i, 'disclaimer present');
});
