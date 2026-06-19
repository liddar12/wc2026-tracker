/* parlay.test.mjs — BR-8 Parlay of the Day. Three 3-leg parlays from today's
   matches (Most likely / Safe-diversified / Best value), model+market blended. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parlayOfTheDay } from '../../app/components/parlay.js';

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

test('schedule view + parlay carry the not-betting-advice disclaimer', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('../../', import.meta.url);
  const sv = readFileSync(new URL('app/views/schedule-view.js', root), 'utf8');
  assert.match(sv, /renderParlayOfDay\(data\)/, 'parlay appended to schedule');
  const pl = readFileSync(new URL('app/components/parlay.js', root), 'utf8');
  assert.match(pl, /not betting advice/i, 'disclaimer present');
});
