/* rj30-markets-merge.test.mjs — RJ30-1: mergedMarkets(data) overlays Polymarket
   per-match outcomes UNDER Kalshi (Kalshi wins on conflict) so the matchup-detail
   market bar + divergence light up for Polymarket-only fixtures too. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergedMarkets, getMatchOutcome } from '../../app/markets.js';

function data() {
  return {
    markets: {
      source: 'kalshi',
      updated_at: '2026-06-20T12:00:00+00:00',
      tournament_winner: [{ team: 'Brazil', ticker: 'X', prob_pct: 18, delta_24h_pp: 0 }],
      match_outcomes: {
        'A__vs__B': { team_a: 'A', team_b: 'B', team_a_prob: 0.50, draw_prob: 0.25, team_b_prob: 0.25, source: 'kalshi' },
      },
    },
    polymarketOdds: {
      source: 'polymarket',
      updated_at: '2026-06-20T13:00:00+00:00',
      match_outcomes: {
        // conflict with Kalshi on A__vs__B (different probs) — Kalshi must win.
        'A__vs__B': { team_a: 'A', team_b: 'B', team_a_prob: 0.70, draw_prob: 0.15, team_b_prob: 0.15, source: 'polymarket' },
        // Polymarket-only fixture — must appear in the merge.
        'C__vs__D': { team_a: 'C', team_b: 'D', team_a_prob: 0.40, draw_prob: 0.30, team_b_prob: 0.30, source: 'polymarket' },
      },
    },
  };
}

test('mergedMarkets has BOTH keys; Kalshi wins the conflict', () => {
  const m = mergedMarkets(data());
  assert.ok(m.match_outcomes['A__vs__B'], 'conflict key present');
  assert.ok(m.match_outcomes['C__vs__D'], 'Polymarket-only key present');
  assert.equal(m.match_outcomes['A__vs__B'].source, 'kalshi', 'Kalshi record wins on conflict');
  assert.equal(m.match_outcomes['A__vs__B'].team_a_prob, 0.50, 'Kalshi probs retained');
});

test('getMatchOutcome on the merge returns the Polymarket-only record', () => {
  const m = mergedMarkets(data());
  const rec = getMatchOutcome(m, { team_a: 'C', team_b: 'D' });
  assert.ok(rec, 'C v D resolved from Polymarket');
  assert.equal(rec.source, 'polymarket');
  assert.equal(rec.team_a_prob, 0.40);
});

test('mergedMarkets preserves the top-level markets fields (tournament_winner, source)', () => {
  const m = mergedMarkets(data());
  assert.equal(m.source, 'kalshi', 'markets source preserved');
  assert.ok(Array.isArray(m.tournament_winner) && m.tournament_winner.length, 'winner list preserved');
});

test('mergedMarkets is safe when Polymarket is absent (returns markets as-is shape)', () => {
  const d = data();
  delete d.polymarketOdds;
  const m = mergedMarkets(d);
  assert.deepEqual(Object.keys(m.match_outcomes).sort(), ['A__vs__B'], 'only Kalshi outcomes');
});

test('mergedMarkets is safe when markets is absent (Polymarket-only)', () => {
  const d = data();
  delete d.markets;
  const m = mergedMarkets(d);
  assert.ok(m.match_outcomes['C__vs__D'], 'Polymarket outcomes still surface');
  assert.ok(getMatchOutcome(m, { team_a: 'C', team_b: 'D' }), 'getMatchOutcome works');
});
