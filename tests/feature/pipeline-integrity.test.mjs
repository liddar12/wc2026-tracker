/* pipeline-integrity.test.mjs — Epic A (RCA bugs 4–10): pipeline race-condition
   + deterministic-model + real-gate hardening.

   Covers:
   1. KILL THE CLOBBER RACE — the 4 data-writing crons share ONE cross-workflow
      concurrency group (data-writers) and no longer rebase with `-X theirs`
      (which silently discarded the other cron's just-committed data).
   2. CONTENT-AWARE META — meta.data_version only bumps when data actually
      changed (no-op crons stop burning a Netlify deploy); the dead
      frequent_update gate is fixed.
   3. VALIDATE AS A REAL GATE — `validate_data.py --strict` exits non-zero on a
      fixture with an empty volatile feed AND on a fixture whose resolved
      real-team knockout fixture lacks a knockout_matchups.json row / xg key.
      (Run against crafted temp dirs so it never depends on the live data
      state — knockout_matchups.json may not exist yet during this run.)
   4. EPIC B WIRING — build_knockout_matchups.py runs AFTER resolve_knockouts +
      compute_xg and BEFORE validate in the three model crons.
   5. ATOMIC + ENCODING — data writes route through _common.save_json (tmp +
      os.replace) with ensure_ascii=True; build_hybrid/optimize_weights match.
   6. STALENESS — scrapers only bump __meta__.updated_at when real data changed;
      check_staleness alarms on emptiness.
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const DATA_CRONS = ['daily_update.yml', 'frequent_update.yml', 'live_update.yml', 'pre_kickoff_update.yml'];

// ---------------------------------------------------------------------------
// 1. Cross-workflow concurrency group + no -X theirs (the clobber race)
// ---------------------------------------------------------------------------
test('all 4 data-writing crons serialize on ONE shared concurrency group', () => {
  for (const wf of DATA_CRONS) {
    const y = read(`.github/workflows/${wf}`);
    assert.match(y, /group:\s*data-writers/, `${wf}: shares the data-writers concurrency group`);
    assert.match(y, /cancel-in-progress:\s*false/, `${wf}: queues (never cancels) so commits land`);
  }
});

test('no cron rebases with -X theirs (it silently discarded sibling cron data)', () => {
  for (const wf of DATA_CRONS) {
    const y = read(`.github/workflows/${wf}`);
    // Ignore YAML/shell comment lines (they explain WHY -X theirs was removed).
    const code = y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.ok(!/-X\s*theirs/.test(code), `${wf}: must not use 'git pull --rebase -X theirs' in a command`);
    assert.match(code, /git pull --rebase origin main/, `${wf}: uses a plain rebase`);
  }
});

// ---------------------------------------------------------------------------
// 2. Content-aware meta bump + the dead frequent gate
// ---------------------------------------------------------------------------
test('frequent_update bumps meta.data_version only when real data changed', () => {
  const y = read('.github/workflows/frequent_update.yml');
  // The guard must inspect data/ excluding meta.json (a meta-only diff is a no-op).
  assert.match(y, /git status --porcelain data\//, 'inspects the working tree for real data changes');
  assert.match(y, /meta\.json/, 'excludes meta.json from the change check');
  // and must restore meta.json (not leave a stray bump) when nothing changed.
  assert.match(y, /git checkout -- data\/meta\.json/, 'reverts a no-op meta bump');
});

// ---------------------------------------------------------------------------
// 3. validate_data.py --strict is a REAL gate (fixtures, not live data)
// ---------------------------------------------------------------------------
function buildFixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'wc26-validate-'));
  const data = join(dir, 'data');
  mkdirSync(data);
  // Start from the real data so all the OTHER checks pass; we then mutate.
  cpSync(new URL('data', root).pathname, data, { recursive: true });
  return { dir, data };
}
function writeJson(data, name, obj) {
  writeFileSync(join(data, name), JSON.stringify(obj, null, 2) + '\n');
}
function runValidate(data, extraArgs = []) {
  const r = spawnSync('python3', [join(ROOT, 'scripts/validate_data.py'), '--data-dir', data, ...extraArgs],
    { encoding: 'utf8' });
  return r;
}

test('strict validate exits non-zero when a volatile feed is empty mid-tournament', () => {
  const { dir, data } = buildFixtureDir();
  try {
    // Empty the volatile scorers feed (only its __meta__ remains).
    writeJson(data, 'scorers.json', { __meta__: { updated_at: '2026-06-30T00:00:00+00:00' } });
    // Empty the tournament-winner market too.
    const markets = JSON.parse(readFileSync(join(data, 'markets.json'), 'utf8'));
    markets.tournament_winner = [];
    writeJson(data, 'markets.json', markets);
    const r = runValidate(data, ['--strict', '--now', '2026-06-30']);
    assert.notEqual(r.status, 0, `strict validate must FAIL on empty volatile feeds (stderr: ${r.stderr})`);
    assert.match(r.stderr, /empty|stale/i, 'reports the empty/stale feed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strict validate exits non-zero when a resolved knockout fixture lacks a matchup row', () => {
  const { dir, data } = buildFixtureDir();
  try {
    // schedule_full already has resolved real-team R32 fixtures. Provide an
    // EMPTY knockout_matchups.json (Epic B's file present but not covering them)
    // and matching empty xg coverage → strict coverage check must fail.
    writeJson(data, 'knockout_matchups.json', []);
    const r = runValidate(data, ['--strict', '--now', '2026-06-30']);
    assert.notEqual(r.status, 0, `strict validate must FAIL on missing knockout coverage (stderr: ${r.stderr})`);
    assert.match(r.stderr, /knockout/i, 'reports the uncovered knockout fixture');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strict validate PASSES when knockout fixtures are fully covered', () => {
  const { dir, data } = buildFixtureDir();
  try {
    const sched = JSON.parse(readFileSync(join(data, 'schedule_full.json'), 'utf8'));
    const xg = JSON.parse(readFileSync(join(data, 'xg.json'), 'utf8'));
    const KO = new Set(['round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final']);
    const teams = new Set(Object.keys(JSON.parse(readFileSync(join(data, 'teams.json'), 'utf8'))));
    const isReal = (t) => teams.has(t);
    const rows = [];
    for (const m of sched) {
      if (!KO.has(m.stage)) continue;
      if (!isReal(m.team_a) || !isReal(m.team_b)) continue;
      const key = `${m.team_a}__vs__${m.team_b}`;
      xg[key] = { team_a: m.team_a, team_b: m.team_b, team_a_xg: 1.2, team_b_xg: 1.0 };
      rows.push({ team_a: m.team_a, team_b: m.team_b, is_knockout: true, stage: m.stage,
        match_id: m.match_id, kickoff_utc: m.kickoff_utc });
    }
    writeJson(data, 'xg.json', xg);
    writeJson(data, 'knockout_matchups.json', rows);
    // keep volatile feeds populated so only the coverage axis is under test
    const r = runValidate(data, ['--strict', '--now', '2026-06-30', '--skip-feed-freshness']);
    assert.equal(r.status, 0, `strict validate should PASS with full knockout coverage (stderr: ${r.stderr})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plain (non-strict) validate still passes on the live data (no new hard gate by default)', () => {
  const r = spawnSync('python3', [join(ROOT, 'scripts/validate_data.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `plain validate must stay green on live data (stderr: ${r.stderr})`);
});

// ---------------------------------------------------------------------------
// 4. Epic B step wiring
// ---------------------------------------------------------------------------
test('build_knockout_matchups runs after resolve+xg and before validate in model crons', () => {
  for (const wf of ['daily_update.yml', 'frequent_update.yml', 'live_update.yml']) {
    const y = read(`.github/workflows/${wf}`);
    assert.match(y, /build_knockout_matchups\.py/, `${wf}: runs the knockout matchups builder`);
    assert.ok(y.indexOf('resolve_knockouts.py') < y.indexOf('build_knockout_matchups.py'),
      `${wf}: builder runs after resolve_knockouts`);
    assert.ok(y.indexOf('compute_xg.py') < y.indexOf('build_knockout_matchups.py'),
      `${wf}: builder runs after compute_xg`);
    assert.ok(y.indexOf('build_knockout_matchups.py') < y.indexOf('validate_data.py'),
      `${wf}: builder runs before validate`);
  }
});

// ---------------------------------------------------------------------------
// 5. Atomic writes + ensure_ascii=True
// ---------------------------------------------------------------------------
// A real json call argument: `ensure_ascii=False` NOT preceded by `using `
// (so docstring prose like "a co-writer using ensure_ascii=False" is ignored).
const ENSURE_ASCII_FALSE_CALL = /(?<!using )ensure_ascii=False/;

test('_common.save_json is atomic (tmp + replace) and ASCII-safe', () => {
  const s = read('scripts/_common.py');
  assert.match(s, /\.tmp/, 'writes to a temp file');
  assert.match(s, /\.replace\(/, 'atomic os.replace swap');
  assert.match(s, /json\.dump\([^)]*ensure_ascii=True/, 'on-disk encoding is ASCII (matches data/*.json)');
  assert.ok(!ENSURE_ASCII_FALSE_CALL.test(s), 'no ensure_ascii=False call in the shared writer');
});

test('co-writers of group_matchups/meta use ensure_ascii=True', () => {
  for (const f of ['scripts/build_hybrid.py', 'scripts/optimize_weights.py']) {
    const s = read(f);
    assert.ok(!ENSURE_ASCII_FALSE_CALL.test(s), `${f}: no ensure_ascii=False call`);
  }
});

test('build_hybrid writes group_matchups + forecast atomically (no clobber on crash)', () => {
  const s = read('scripts/build_hybrid.py');
  // must not open the destination directly for writing (non-atomic truncate).
  assert.ok(!/open\(dpath\("group_matchups\.json"\),\s*"w"\)/.test(s),
    'group_matchups.json is not written via a direct truncating open');
  assert.match(s, /save_json|os\.replace|\.replace\(/, 'uses an atomic write helper');
});

// ---------------------------------------------------------------------------
// 6. Staleness: scrapers only bump on real change; watchdog alarms on emptiness
// ---------------------------------------------------------------------------
test('scrapers only bump __meta__.updated_at when real data changed', () => {
  for (const f of ['scripts/scrape_form.py', 'scripts/scrape_scorers.py', 'scripts/scrape_referees.py']) {
    const s = read(f);
    // Snapshot the payload before the scrape and early-return (no updated_at
    // bump, no rewrite) when it's unchanged — a no-op bump would make the feed
    // look fresh forever and defeat the staleness watchdog.
    assert.match(s, /before/, `${f}: snapshots the prior payload`);
    assert.match(s, /no data change|== before|leaving updated_at untouched/i,
      `${f}: guards the updated_at bump on a real change`);
  }
});

test('check_staleness alarms on an empty watched feed (not just an old commit)', () => {
  const s = read('scripts/check_staleness.py');
  assert.match(s, /empt/i, 'emptiness is a staleness signal');
});
