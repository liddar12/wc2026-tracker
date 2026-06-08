import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('snapshot_backtest reuses build_hybrid math (no model drift)', () => {
  const s = read('scripts/snapshot_backtest.py');
  assert.match(s, /import build_hybrid as bh/, 'imports build_hybrid');
  assert.match(s, /bh\.wdl\(/, 'uses build_hybrid.wdl for DT/strength legs');
  assert.match(s, /bh\.zscore|sig\["z_dt"\]/, 'uses build_hybrid z-scores');
});

test('snapshot_backtest captures all five forecasters + scores them', () => {
  const s = read('scripts/snapshot_backtest.py');
  for (const m of ['model', 'dt', 'market', 'polymarket', 'hybrid']) {
    assert.match(s, new RegExp(`"${m}"`), `captures ${m}`);
  }
  assert.match(s, /brier/i, 'scores Brier');
  assert.match(s, /logloss|log-loss/i, 'scores log-loss');
  assert.match(s, /live2026/, 'writes the live2026 summary into backtest.json');
});

test('snapshot_backtest filters the moneyline slug (prop-market collision fix)', () => {
  const s = read('scripts/snapshot_backtest.py');
  assert.match(s, /PM_MONEYLINE\s*=\s*re\.compile/, 'has a moneyline slug regex');
  assert.match(s, /fifwc-.+-\\d\{4\}-\\d\{2\}-\\d\{2\}\$/, 'regex anchors on the date (excludes -halftime/-exact-score variants)');
});

test('cron wires the snapshot after build_hybrid in live + frequent updates', () => {
  for (const wf of ['.github/workflows/live_update.yml', '.github/workflows/frequent_update.yml']) {
    const y = read(wf);
    assert.match(y, /scripts\/snapshot_backtest\.py/, `${wf} runs snapshot_backtest`);
    const hybridAt = y.indexOf('build_hybrid.py');
    const snapAt = y.indexOf('snapshot_backtest.py');
    assert.ok(hybridAt > 0 && snapAt > hybridAt, `${wf} runs snapshot after build_hybrid`);
  }
});

test('initialized data files carry the expected shape', () => {
  const live = JSON.parse(read('data/live-backtest.json'));
  assert.ok(live.matches && typeof live.matches === 'object', 'live-backtest has a matches map');
  assert.ok(live.summary && 'matches_scored' in live.summary, 'live-backtest has a summary');
  const bt = JSON.parse(read('data/backtest.json'));
  assert.ok(bt.live2026, 'backtest.json has a live2026 panel');
});
