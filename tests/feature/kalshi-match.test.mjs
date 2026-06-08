import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(p, 'utf8');

test('scrape_kalshi fetches per-match 1X2 from KXWCGAME (de-vigged)', () => {
  const s = read('scripts/scrape_kalshi.py');
  assert.match(s, /GAME_SERIES\s*=\s*"KXWCGAME"/, 'uses the KXWCGAME series');
  assert.match(s, /def fetch_match_outcomes\(valid/, 'takes valid teams');
  assert.match(s, /team_a_prob|draw_prob|team_b_prob/, 'writes 1X2 probabilities');
  assert.match(s, /pa \/ tot|draw_prob.*\/ tot|\/ tot/, 'normalises (de-vig) to sum 1');
  assert.match(s, /_canonical_matchups/, 'orients keys to the app matchOutcomeKey order');
  assert.doesNotMatch(s, /not mapped yet/, 'old stub removed');
});

test('build_hybrid blends real per-match Kalshi odds when present', () => {
  const s = read('scripts/build_hybrid.py');
  assert.match(s, /match_outcomes/, 'reads markets.match_outcomes');
  assert.match(s, /kalshi_live/, 'counts matches using live per-match Kalshi');
  // ⅓ each at the match level
  assert.match(s, /\(j\[0\] \+ d\[0\] \+ k\[0\]\) \/ 3/, 'averages J5L + DT + Kalshi distributions');
});

test('match_outcomes consumer contract intact (markets.js)', () => {
  const m = read('app/markets.js');
  assert.match(m, /team_a_prob/, 'reads team_a_prob');
  assert.match(m, /__vs__/, 'keys by team_a__vs__team_b');
});
