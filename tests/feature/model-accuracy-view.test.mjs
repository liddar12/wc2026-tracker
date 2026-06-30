/* model-accuracy-view.test.mjs — RJ30-11: the per-match model-accuracy view
   reads data/live-backtest.json, filters on `scored`, renders per-match Brier,
   escapes strings, and (critically) reads aggregates off `summary` rather than
   re-deriving a mean over matches (so it can't drift from the Backtest view). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRows } from '../../app/views/model-accuracy-view.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const SRC = read('app/views/model-accuracy-view.js');

test('view fetches live-backtest.json, imports escapeHtml, filters scored, renders Brier', () => {
  assert.match(SRC, /fetch\(\s*['"]data\/live-backtest\.json['"]/, 'fetches the live-backtest feed');
  assert.match(SRC, /escape\.js/, 'imports the canonical escaper');
  assert.match(SRC, /escapeHtml/, 'uses escapeHtml on rendered strings');
  assert.match(SRC, /\.scored\s*===\s*true/, 'filters on scored===true');
  assert.match(SRC, /brier/i, 'renders per-match Brier');
});

test('aggregate uses summary, not a re-derived mean over matches (guards drift)', () => {
  assert.match(SRC, /summary\[/, 'reads aggregates off live.summary[model]');
  // Must NOT reduce/average over the matches map to compute the header brier.
  assert.doesNotMatch(SRC, /matches[^]*?\.reduce\([^]*?brier/, 'does not re-average brier over matches');
});

test('buildRows returns [] + showEmpty on no scored matches', () => {
  const out = buildRows({ matches: {}, summary: { matches_scored: 0 } });
  assert.deepEqual(out.rows, []);
  assert.equal(out.showEmpty, true);
  assert.deepEqual(out.header, []);
});

test('buildRows skips unscored matches and surfaces per-model cells + market delta', () => {
  const live = {
    summary: {
      model: { correct: 1, total: 1, brier: 0.05, logloss: 0.2 },
      market: { correct: 1, total: 1, brier: 0.15, logloss: 0.4 },
    },
    matches: {
      a: {
        match_number: 2, team_a: 'Argentina', team_b: 'Brazil', scored: true,
        actual: 'team_a_wins', actual_score: '2-0',
        score: {
          model: { correct: 1, brier: 0.05, logloss: 0.2 },
          market: { correct: 1, brier: 0.15, logloss: 0.4 },
        },
      },
      b: { match_number: 1, team_a: 'France', team_b: 'Spain', scored: false },
    },
  };
  const out = buildRows(live);
  assert.equal(out.showEmpty, false);
  assert.equal(out.rows.length, 1, 'only the scored match is rowed');
  assert.equal(out.rows[0].team_a, 'Argentina');
  const modelCell = out.rows[0].cells.find((c) => c.model === 'model');
  assert.equal(modelCell.present, true);
  assert.equal(modelCell.correct, true);
  assert.equal(modelCell.brier, 0.05);
  // Brier − Market = 0.05 − 0.15 = −0.10 (sharper than market).
  assert.equal(modelCell.deltaVsMarket, -0.1);
  // A model absent for a match must not crash → present:false cell.
  const poly = out.rows[0].cells.find((c) => c.model === 'polymarket');
  assert.equal(poly.present, false);
});

test('header aggregates come straight off summary (percent computed from correct/total)', () => {
  const live = {
    summary: { model: { correct: 47, total: 72, brier: 0.5098, logloss: 0.9053 } },
    matches: {},
  };
  const out = buildRows(live);
  const h = out.header.find((x) => x.model === 'model');
  assert.equal(h.pct, Math.round((47 / 72) * 100));
  assert.equal(h.brier, 0.5098, 'brier is the summary value verbatim (not re-derived)');
});
