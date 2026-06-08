import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('backtest.json: only Euro 2024 market is measured, the rest are flagged estimates', () => {
  const bt = JSON.parse(read('data/backtest.json'));
  assert.equal(bt.__meta__.measured_source, 'polymarket');

  const m = bt.euro2024.market;
  assert.equal(m.measured, true, 'euro2024 market is measured');
  assert.equal(m.source, 'polymarket');
  assert.ok(m.brier != null && m.logloss != null, 'measured market carries Brier + log-loss');
  assert.ok(m.decisive_total > 0, 'measured market carries decisive split');

  // every non-measured row across both tournaments must be explicitly estimate:true
  for (const t of ['euro2024', 'wc2022']) {
    for (const k of ['model', 'dt', 'market', 'hybrid']) {
      const row = bt[t][k];
      if (row.measured) continue;
      assert.equal(row.estimate, true, `${t}.${k} flagged estimate`);
    }
  }
  // WC2022 has no measured row at all (no per-match Polymarket data)
  assert.ok(!Object.values(bt.wc2022).some((v) => v && v.measured), 'wc2022 has nothing measured');
});

test('backtest view distinguishes measured vs estimate and explains the limitation', () => {
  const v = read('app/views/backtest-view.js');
  assert.match(v, /backtest-badge measured/, 'renders a measured badge');
  assert.match(v, /backtest-badge est/, 'renders an estimate badge');
  assert.match(v, /backtest-disclaimer/, 'shows the disclaimer banner');
  assert.match(v, /live2026/, 'has the WC2026 live-backtest hook');
});
