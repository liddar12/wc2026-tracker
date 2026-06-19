import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

test('forecast.json: 1/3 hybrid champion+round odds (group→finals)', () => {
  const f = json('data/forecast.json');
  assert.equal(f.teams.length, 48);
  // Blend is now backtest-TUNED (meta.hybrid_weights), no longer hardcoded 1/3.
  const w = f.model.weights;
  assert.ok(['j5l', 'dt', 'kalshi'].every((k) => typeof w[k] === 'number'), 'three blend weights');
  assert.ok(Math.abs(w.j5l + w.dt + w.kalshi - 1) < 0.02, 'blend weights sum to 1');
  const champ = f.teams.reduce((s, t) => s + t.champion, 0);
  assert.ok(Math.abs(champ - 1) < 0.01, `champion sums ~1 (got ${champ.toFixed(3)})`);
  f.teams.forEach((t) => {
    assert.ok(typeof t.hybrid_strength === 'number', 'hybrid_strength present');
    // survival monotonic: r32 >= r16 >= ... >= champion
    const seq = [t.r32, t.r16, t.qf, t.sf, t.final, t.champion];
    assert.ok(seq.every((v, i) => i === 0 || seq[i - 1] >= v - 1e-9), 'monotone survival');
  });
});

test('group bars are the hybrid; J5L preserved under j5l_probabilities', () => {
  const gm = json('data/group_matchups.json');
  let n = 0, j5l = 0;
  for (const g of Object.values(gm)) for (const m of g.matches) {
    const p = m.probabilities; n++;
    assert.ok(Math.abs(p.team_a_wins + p.draw + p.team_b_wins - 100) < 0.3, 'hybrid probs sum 100');
    if (m.j5l_probabilities) j5l++;
  }
  assert.equal(j5l, n, 'every match keeps its J5L probabilities');
});

test('hybrid is the default model + documented as 1/3', () => {
  const am = read('app/lib/active-model.js');
  assert.match(am, /if \(!storage\) return 'hybrid'/, 'default model is hybrid');
  assert.match(am, /⅓ blend of J5L \+ DT \+ Markets/, 'hybrid description updated');
  const dl = read('app/data-loader.js');
  assert.match(dl, /forecast\.json/, 'data-loader registers forecast.json');
  assert.match(dl, /case 'forecast\.json':\s*return 'forecast'/, 'fileToKey maps forecast');
  const ba = read('app/bracket-autofill.js');
  assert.match(ba, /forecast\?\.teams/, 'bracket hybrid source reads forecast hybrid_strength');
});

test('build_hybrid.py exists; equal-thirds is the default, meta blend overrides', () => {
  const s = read('scripts/build_hybrid.py');
  assert.match(s, /W = \(1 \/ 3, 1 \/ 3, 1 \/ 3\)/, 'equal-thirds default constant');
  assert.match(s, /meta\.get\("hybrid_weights"\)/, 'tuned blend overrides the default');
  assert.match(s, /forecast\.json/, 'writes forecast.json');
});
