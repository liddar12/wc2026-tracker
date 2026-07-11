/* r23-ko-context.test.mjs — R23: knockout rest/travel context feeding the AI
 * previews. Locks the data contract (data/ko_context.json coverage), the
 * generate_previews enrichment + static prompt nudge, and the cron wiring
 * (context built BEFORE previews in the hourly refresh). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const J = (p) => JSON.parse(read(p));

test('data/ko_context.json: KO fixtures with rest + travel coverage', () => {
  const ctx = J('data/ko_context.json');
  const rows = Object.entries(ctx).filter(([k]) => k !== '__meta__');
  assert.ok(rows.length >= 20, `knockout fixtures present (${rows.length})`);
  let rest = 0, travel = 0;
  for (const [key, v] of rows) {
    assert.match(key, /__vs__/, 'pair-keyed');
    assert.ok(v.tier && typeof v.played === 'boolean', 'tier + played flags');
    for (const side of ['team_a', 'team_b']) {
      assert.ok(v[side] && typeof v[side].team === 'string', `${side} block`);
      const r = v[side].rest_days;
      const t = v[side].travel_km;
      assert.ok(r === null || (typeof r === 'number' && r >= 0 && r < 40), `sane rest (${r})`);
      assert.ok(t === null || (typeof t === 'number' && t >= 0 && t < 6000), `sane travel (${t})`);
    }
    if (v.team_a.rest_days !== null) rest++;
    if (v.team_a.travel_km !== null) travel++;
  }
  assert.ok(rest / rows.length > 0.8, `rest coverage high (${rest}/${rows.length})`);
  assert.ok(travel / rows.length > 0.8, `travel coverage high (${travel}/${rows.length})`);
});

test('generate_previews folds the context into KO preview prompts', () => {
  const gp = read('scripts/generate_previews.py');
  assert.match(gp, /ko_context\.json/, 'previews load ko_context.json');
  assert.match(gp, /_ko_context_fields/, 'typed rest/travel enrichment');
  assert.match(gp, /rest_days_|travel_km_/, 'flat typed field names');
  assert.match(gp, /rest-day or travel-km/, 'static preview prompt nudge (cache-stable)');
});

test('cron wiring: context built before previews; self-tests in the smoke gate', () => {
  const wf = read('.github/workflows/frequent_update.yml');
  const ctxIdx = wf.indexOf('build_ko_context.py');
  const prevIdx = wf.indexOf('generate_previews.py');
  assert.ok(ctxIdx > -1, 'frequent cron builds KO context');
  assert.ok(prevIdx > ctxIdx, 'context step precedes the previews step');
  const smoke = read('tests/smoke.sh');
  for (const s of ['generate_previews.py', 'compute_dominance.py', 'build_ko_context.py']) {
    assert.match(smoke, new RegExp(s.replace('.', '\\.')), `${s} self-test in smoke gate`);
  }
});
