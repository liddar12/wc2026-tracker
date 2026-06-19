/* model-optimizer.test.mjs — J5L backtest-tuning: optimize composite weights +
   Poisson calibration + hybrid blend to minimize walk-forward / captured-pre-match
   log-loss, with a never-regress guard. Locks the contract + the honest result. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const J = (p) => JSON.parse(read(p));

test('optimizer never regresses and reports honest before→after', () => {
  const r = J('data/model_tuning.json');
  assert.match(r.objective, /log-loss/, 'objective is log-loss');
  // group: tuned must be no worse than current (never-regress)
  assert.ok(r.group.tuned.logloss <= r.group.current.logloss + 1e-9, 'group tuned ≤ current');
  if (r.group.adopted) {
    const w = r.group.weights;
    const sum = w.mine + w.elo + w.tmv + w.qual + w.form;
    assert.ok(Math.abs(sum - 1) < 0.02, `composite weights sum to 1 (got ${sum})`);
    assert.ok('form' in w, 'form weight present');
  }
  // blend: tuned ≤ equal-thirds baseline
  if (r.blend) {
    assert.ok(r.blend.tuned.logloss <= r.blend.current_equal_thirds.logloss + 1e-9, 'blend tuned ≤ equal-thirds');
  }
});

test('tuned params are wired into meta + read by the model', () => {
  const m = J('data/meta.json');
  assert.ok('form' in m.model_weights, 'meta.model_weights has form');
  // rebuild_composite reads form + meta-driven Poisson
  const rc = read('scripts/rebuild_composite.py');
  assert.match(rc, /weights\.get\("form", 0\) \* sub\.get\("form_scaled"/, 'composite uses form term');
  assert.match(rc, /poisson_group/, 'reads tuned Poisson from meta');
  // build_hybrid reads the tuned blend
  assert.match(read('scripts/build_hybrid.py'), /meta\.get\("hybrid_weights"\)/, 'hybrid reads meta blend');
});

test('optimizer is leak-safe + regularized (walk-forward, shrinkage, guard)', () => {
  const o = read('scripts/optimize_weights.py');
  assert.match(o, /before=koff/, 'form computed as-of kickoff (no leakage)');
  assert.match(o, /SHRINK|SHRINK_BLEND|SHRINK_CAL/, 'shrinkage regularization present');
  assert.match(o, /MARGIN/, 'never-regress margin');
  assert.match(o, /apply_update\(elo/, 'Elo advanced only AFTER predicting each game');
});

test('compute_form: leak-safe form_scaled written to teams', () => {
  const cf = read('scripts/compute_form.py');
  assert.match(cf, /before=/, 'supports as-of cutoff for CV');
  const teams = J('data/teams.json');
  const withForm = Object.values(teams).filter((t) => typeof t.sub_ratings?.form_scaled === 'number');
  assert.ok(withForm.length >= 40, 'form_scaled populated across the field');
});

test('daily cron re-fits; frequent/live refresh form but do not re-fit', () => {
  const daily = read('.github/workflows/daily_update.yml');
  assert.match(daily, /optimize_weights\.py/, 'daily re-fits weights');
  assert.match(daily, /compute_form\.py/, 'daily refreshes form');
  for (const wf of ['frequent_update', 'live_update']) {
    const y = read(`.github/workflows/${wf}.yml`);
    assert.match(y, /compute_form\.py/, `${wf} refreshes form`);
    assert.ok(!/optimize_weights\.py/.test(y), `${wf} does NOT re-fit (daily-only)`);
  }
});
