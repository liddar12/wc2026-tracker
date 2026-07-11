import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAutofill } from '../../app/bracket-autofill.js';
import { MODELS, MODEL_LABELS, modelToAutofillSource, getActiveModel } from '../../app/lib/active-model.js';
import { modelPickForMatch } from '../../app/lib/model-pick.js';

const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

test('stacker.json: learned J5L+DT blend — alpha in range + per-team strengths', () => {
  const s = json('data/stacker.json');
  assert.equal(s.model.id, 'stack');
  assert.equal(s.model.name, 'J5L AI Enhanced');
  assert.ok(s.alpha >= 0.15 && s.alpha <= 0.95, `alpha in [0.15,0.95] (got ${s.alpha})`);
  const teams = json('data/teams.json');
  const names = Object.keys(teams);
  assert.equal(Object.keys(s.strengths).length, names.length, 'a strength per team');
  for (const n of names) assert.equal(typeof s.strengths[n], 'number', `strength for ${n}`);
  // fit metrics recorded (n_matches from played results; may be 0 pre-tournament)
  assert.ok(typeof s.fit.n_matches === 'number', 'fit.n_matches present');
});

test('stack replaces consensus in the model picker + maps to its own autofill source', () => {
  assert.deepEqual(MODELS, ['j5l', 'dt', 'kalshi', 'hybrid', 'stack']);
  assert.ok(!MODELS.includes('consensus'), 'consensus is no longer a picker model');
  assert.equal(MODEL_LABELS.stack, 'J5L AI Enhanced');
  assert.equal(modelToAutofillSource('stack'), 'stack');
});

test('bracket-autofill stack source advances the higher stacker strength', () => {
  // Minimal 2-team R32 fixture; stacker gives B the higher strength → B advances.
  const data = {
    teams: { Alpha: { composite: 70 }, Beta: { composite: 60 } },
    stacker: { strengths: { Alpha: 0.2, Beta: 1.5 } },
    scheduleFull: [
      { match_number: 1, stage: 'round_of_32', team_a: 'Alpha', team_b: 'Beta',
        kickoff_utc: '2026-07-05T18:00:00Z' },
    ],
    actualResults: {},
  };
  const picks = buildAutofill(data, 'stack');
  const m1 = picks.find((p) => p.matchNumber === 1);
  assert.ok(m1, 'R32 pick produced');
  assert.equal(m1.team, 'Beta', 'higher stacker strength (Beta) advances, not the higher composite (Alpha)');
});

test('stack is the DEFAULT model when no storage is set', () => {
  assert.equal(getActiveModel(null), 'stack');
});

test('modelPickForMatch defaults to the stack pick (higher blend strength wins)', () => {
  const data = { stacker: { strengths: { France: 1.79, Morocco: -0.2 } }, markets: {} };
  const match = { team_a: 'France', team_b: 'Morocco', probabilities: { team_a_wins: 52, draw: 24, team_b_wins: 24 } };
  const pick = modelPickForMatch(match, data); // no model arg → active/default = stack
  assert.equal(pick.source, 'stack');
  assert.equal(pick.side, 'team_a');
  assert.ok(pick.prob_pct > 52, 'stack confidence reflects the blend gap, not the raw J5L bar');
});

test('backtest.json live2026 carries a measured stack row', () => {
  const bt = json('data/backtest.json');
  const s = bt.live2026 && bt.live2026.stack;
  assert.ok(s && typeof s.total === 'number' && s.total > 0, 'stack scored in live2026');
  assert.ok(typeof s.logloss === 'number', 'stack has a logloss');
});

test('backtest + model-accuracy views list the stack model', () => {
  assert.match(read('app/views/backtest-view.js'), /stack: 'J5L AI Enhanced'/, 'backtest LIVE_LABELS has stack');
  assert.match(read('app/views/backtest-view.js'), /\['stack',/, 'live panel renders stack first');
  assert.match(read('app/views/model-accuracy-view.js'), /'stack'/, 'model-accuracy lists stack');
});

test('build_stacker.py + data-loader + bracket-autofill are wired for stack', () => {
  const s = read('scripts/build_stacker.py');
  assert.match(s, /stacker\.json/, 'build_stacker writes stacker.json');
  assert.match(s, /alpha \* z|alpha\*z|1 - alpha/, 'alpha-blend of z-scored J5L + DT');
  const dl = read('app/data-loader.js');
  assert.match(dl, /stacker\.json/, 'data-loader registers stacker.json');
  const ba = read('app/bracket-autofill.js');
  assert.match(ba, /stacker\?\.strengths/, 'stack source reads stacker strengths');
});

// R21: the KNOCKOUT pipeline's headline probabilities follow the stack (the
// app default), not the raw J5L composite — so the To-advance header, the
// W/D/L bar, knockout cards AND the in-play prior (priorFromMatch prefers
// advance_pct) all inherit the self-learning model. The faithful composite
// probs stay under j5l_probabilities for the model grid + backtest.
test('R21: knockout rows carry stack-driven headline probs + faithful J5L record', () => {
  const script = read('scripts/build_knockout_matchups.py');
  assert.match(script, /stacker\.json/, 'build_knockout_matchups reads the learned stack');
  assert.match(script, /bh\.wdl/, 'same Poisson mapping as the stacker fit');

  const rows = json('data/knockout_matchups.json');
  assert.ok(rows.length > 0, 'knockout rows exist');
  const strengths = json('data/stacker.json').strengths || {};
  for (const r of rows) {
    assert.ok(['stack', 'j5l_composite'].includes(r.prob_source), `prob_source tagged (${r.prob_source})`);
    if (strengths[r.team_a] != null && strengths[r.team_b] != null) {
      assert.equal(r.prob_source, 'stack', `${r.team_a} vs ${r.team_b} uses the stack`);
    }
    assert.ok(r.j5l_probabilities && typeof r.j5l_probabilities.team_a_wins === 'number',
      'composite J5L probs preserved');
    const adv = r.advance_pct_a + r.advance_pct_b;
    assert.ok(Math.abs(adv - 100) < 0.5, `advance pcts sum to 100 (${adv})`);
  }
});
