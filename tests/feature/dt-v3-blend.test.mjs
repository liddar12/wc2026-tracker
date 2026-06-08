import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

test('W/D/L bars use the V3 bivariate-Poisson form (not the old logistic)', () => {
  const src = read('scripts/rebuild_composite.py');
  assert.match(src, /_poisson_pmf/, 'Poisson pmf helper present');
  assert.match(src, /lam_a = math\.exp\(_POIS_MU/, 'lambdas from mu + supremacy');
  assert.doesNotMatch(src, /1 \/ \(1 \+ math\.exp\(-gap \/ 4\.5\)\)/, 'old logistic removed');
});

test('DT model is un-dormant: blended rating + non-zero talent layer', () => {
  const dt = json('data/dt_model.json');
  const tr = dt.team_rankings;
  assert.equal(tr.length, 48, '48 teams');
  assert.match(dt.model.method, /market value/i, 'method documents the blend');
  assert.equal(dt.model.w_elo, 0.6); assert.equal(dt.model.w_market, 0.4);
  const nonzero = tr.filter((r) => r.components?.talent_z !== 0).length;
  assert.ok(nonzero >= 44, `talent_z non-zero for most teams (got ${nonzero}/48, was 0/48)`);
  tr.forEach((r) => {
    assert.ok(r.rating >= 0 && r.rating <= 100, 'rating in [0,100]');
    assert.ok(typeof r.components.elo_z === 'number');
  });
  const sum = tr.reduce((s, r) => s + r.title_prob, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `title_prob sums to ~1 (got ${sum.toFixed(3)})`);
});

test('group_matchups probabilities are well-formed (sum to 100)', () => {
  const gm = json('data/group_matchups.json');
  let n = 0;
  for (const g of Object.values(gm)) for (const m of g.matches) {
    const p = m.probabilities; const s = p.team_a_wins + p.draw + p.team_b_wins;
    assert.ok(Math.abs(s - 100) < 0.3, `probs sum ~100 (got ${s})`); n++;
  }
  assert.ok(n > 0, 'matches present');
});
