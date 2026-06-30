/* knockout-data.test.mjs — Epic B (RCA 1/2/3-data, 11, 25, 26).
   The knockout stage froze with NO per-match prediction data: group_matchups
   only covers groups, xg.json only had group keys, and scrape_live_results
   only recorded a winner for penalty ties — so a regulation knockout win never
   wrote rec.winner and the bracket couldn't score it.

   This locks the Epic B data contract:
   - data/knockout_matchups.json is a non-empty ARRAY of match rows mirroring a
     group_matchups row + advance_pct_a/advance_pct_b + is_knockout, with rows
     for the real R32 fixtures (Belgium/Senegal, Mexico/Ecuador).
   - data/xg.json carries knockout "TeamA__vs__TeamB" pair keys.
   - the live-results parse writes a winner for a 2-1 STATUS_FULL_TIME knockout
     (regulation win), not only for penalty ties. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const rd = (p) => readFileSync(new URL(p, root), 'utf8');
const py = (code) =>
  execFileSync('python3', ['-c', code], { cwd: new URL('.', root).pathname, encoding: 'utf8' });

test('knockout_matchups.json is a non-empty array of knockout match rows', () => {
  const rows = JSON.parse(rd('data/knockout_matchups.json'));
  assert.ok(Array.isArray(rows), 'top-level is an array');
  assert.ok(rows.length > 0, 'non-empty');
  for (const r of rows) {
    assert.equal(r.is_knockout, true, `${r.team_a} v ${r.team_b}: is_knockout flag`);
    assert.ok(r.team_a && r.team_b, 'has both team names');
    assert.ok(typeof r.win_confidence_pct === 'number', 'win_confidence_pct numeric');
    assert.ok(r.probabilities && typeof r.probabilities.team_a_wins === 'number'
      && typeof r.probabilities.draw === 'number'
      && typeof r.probabilities.team_b_wins === 'number', 'probabilities shape');
    assert.ok(typeof r.advance_pct_a === 'number' && typeof r.advance_pct_b === 'number',
      'advance_pct_a/advance_pct_b numeric (to-advance %)');
    // advance folds the draw mass via ET/pens → the two sides ≈ 100% between them
    assert.ok(Math.abs((r.advance_pct_a + r.advance_pct_b) - 100) < 0.6,
      `advance_pct_a+b ≈ 100 (got ${r.advance_pct_a}+${r.advance_pct_b})`);
    assert.ok(r.stage && r.stage !== 'group', 'stage is a knockout stage');
    assert.ok(typeof r.match_id === 'string' && r.match_id.length > 0, 'has match_id');
  }
});

test('knockout_matchups.json has rows for Belgium/Senegal and Mexico/Ecuador', () => {
  const rows = JSON.parse(rd('data/knockout_matchups.json'));
  const find = (a, b) => rows.find((r) =>
    (r.team_a === a && r.team_b === b) || (r.team_a === b && r.team_b === a));
  for (const [a, b] of [['Belgium', 'Senegal'], ['Mexico', 'Ecuador']]) {
    const row = find(a, b);
    assert.ok(row, `row for ${a} vs ${b} exists`);
    assert.ok(typeof row.win_confidence_pct === 'number', `${a}/${b}: win_confidence_pct`);
    assert.ok(row.probabilities && typeof row.probabilities.team_a_wins === 'number',
      `${a}/${b}: probabilities`);
    assert.ok(typeof row.advance_pct_a === 'number' && typeof row.advance_pct_b === 'number',
      `${a}/${b}: advance_pct_a/b`);
  }
});

test('xg.json carries knockout TeamA__vs__TeamB pair keys', () => {
  const xg = JSON.parse(rd('data/xg.json'));
  const keys = Object.keys(xg).filter((k) => k !== '__meta__');
  // at least one knockout pair we know is resolved
  const knockoutKeys = [
    'Belgium__vs__Senegal', 'Mexico__vs__Ecuador',
  ];
  const present = knockoutKeys.filter((k) => k in xg);
  assert.ok(present.length > 0,
    `xg.json has knockout pair keys (looked for ${knockoutKeys.join(', ')}; have ${keys.length} total)`);
  for (const k of present) {
    assert.ok(typeof xg[k].team_a_xg === 'number' && typeof xg[k].team_b_xg === 'number',
      `${k}: team_a_xg/team_b_xg numeric`);
  }
});

test('live-results parse writes winner for a 2-1 STATUS_FULL_TIME knockout (regulation win)', () => {
  // Drive the pure parse helper in scrape_live_results.py with a synthetic ESPN
  // event: a knockout match finished 2-1 in regulation. The fix drops the
  // "and sa == sb" gate so the winner (per-competitor winner boolean) is written
  // for regulation wins, not only penalty ties.
  const out = py([
    'import json, importlib.util, pathlib',
    'spec = importlib.util.spec_from_file_location("slr", "scripts/scrape_live_results.py")',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    // competitors oriented t1=team_a, t2=team_b; t1 won 2-1 with winner=True
    'rec = m.parse_result(',
    '  sched_a="Brazil", sched_b="Japan",',
    '  t1="Brazil", t2="Japan", score_1="2", score_2="1",',
    '  status_type="STATUS_FULL_TIME",',
    '  comp1={"winner": True, "score": "2"}, comp2={"winner": False, "score": "1"},',
    '  kickoff="2026-06-29T17:00Z")',
    'print(json.dumps(rec))',
  ].join('\n'));
  const rec = JSON.parse(out.trim());
  assert.equal(rec.score_a, 2);
  assert.equal(rec.score_b, 1);
  assert.equal(rec.status, 'STATUS_FULL_TIME');
  assert.equal(rec.winner, 'Brazil', 'regulation win records the winner');
});
