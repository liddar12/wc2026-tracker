import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAutofill } from '../../app/bracket-autofill.js';
import { MODELS, MODEL_LABELS, modelToAutofillSource } from '../../app/lib/active-model.js';

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

test('build_stacker.py + data-loader + bracket-autofill are wired for stack', () => {
  const s = read('scripts/build_stacker.py');
  assert.match(s, /stacker\.json/, 'build_stacker writes stacker.json');
  assert.match(s, /alpha \* z|alpha\*z|1 - alpha/, 'alpha-blend of z-scored J5L + DT');
  const dl = read('app/data-loader.js');
  assert.match(dl, /stacker\.json/, 'data-loader registers stacker.json');
  const ba = read('app/bracket-autofill.js');
  assert.match(ba, /stacker\?\.strengths/, 'stack source reads stacker strengths');
});
