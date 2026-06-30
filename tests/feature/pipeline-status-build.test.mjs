/* pipeline-status-build.test.mjs — RJ30-12: build_pipeline_status.py builds a
   correct data/pipeline_status.json from a crafted temp data dir. Mirrors the
   pipeline-integrity.test.mjs mkdtempSync + spawnSync pattern so it's
   state-independent (never reads the live data tree). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/build_pipeline_status.py');

function tempData() {
  const dir = mkdtempSync(join(tmpdir(), 'wc26-status-'));
  const data = join(dir, 'data');
  mkdirSync(data);
  return { dir, data };
}
const w = (data, name, obj) => writeFileSync(join(data, name), JSON.stringify(obj, null, 2) + '\n');

function run(data, extra = []) {
  return spawnSync('python3', [SCRIPT, '--data-dir', data, '--out', join(data, 'pipeline_status.json'), ...extra],
    { encoding: 'utf8' });
}

test('builds a degraded status: empty feed → empty, fresh feed → ok, with warnings', () => {
  const { data } = tempData();
  // teams.json: a fresh, populated feed → ok.
  w(data, 'teams.json', { __meta__: { updated_at: new Date().toISOString() }, France: { group: 'A' } });
  // form.json: an EMPTY feed → empty.
  w(data, 'form.json', { __meta__: { updated_at: new Date().toISOString() } });
  // a validate report with one warning.
  const report = join(data, 'report.json');
  writeFileSync(report, JSON.stringify({ generated_at: 'x', errors: [], warnings: ['scorers.json: empty'], files_checked: 3 }) + '\n');

  const r = run(data, ['--validate-report', report]);
  assert.equal(r.status, 0, r.stderr);

  const out = JSON.parse(readFileSync(join(data, 'pipeline_status.json'), 'utf8'));
  assert.equal(out.health, 'degraded', 'empty feed + warning → degraded');
  assert.ok(Array.isArray(out.feeds));
  const teams = out.feeds.find((f) => f.name === 'teams.json');
  const form = out.feeds.find((f) => f.name === 'form.json');
  assert.equal(teams.status, 'ok', 'populated fresh feed is ok');
  assert.equal(form.status, 'empty', 'empty feed is flagged empty');
  assert.ok(Array.isArray(out.warnings) && out.warnings.length === 1, 'warnings folded in');
  assert.equal(out.warning_count, 1);
  assert.ok(typeof out.generated_at === 'string');
});

test('missing feed → status "missing"; the builder still exits 0', () => {
  const { data } = tempData();
  // Only one feed present; the rest of WATCH are missing.
  w(data, 'teams.json', { __meta__: {}, France: { group: 'A' } });
  const r = run(data);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(readFileSync(join(data, 'pipeline_status.json'), 'utf8'));
  const missing = out.feeds.find((f) => f.name === 'players.json');
  assert.equal(missing.status, 'missing');
  assert.equal(out.health, 'degraded');
});

test('a malformed feed does not crash the builder (non-blocking, exit 0)', () => {
  const { data } = tempData();
  writeFileSync(join(data, 'teams.json'), '{ this is not valid json ');
  const r = run(data);
  assert.equal(r.status, 0, `non-blocking on bad feed; stderr:\n${r.stderr}`);
  const out = JSON.parse(readFileSync(join(data, 'pipeline_status.json'), 'utf8'));
  const teams = out.feeds.find((f) => f.name === 'teams.json');
  assert.equal(teams.status, 'missing', 'unreadable feed reported as missing');
});

test('all-ok feeds (no warnings) yield health "ok"', () => {
  const { data } = tempData();
  const now = new Date().toISOString();
  // Populate every watched feed with a non-empty payload.
  w(data, 'teams.json', { France: { group: 'A' } });
  w(data, 'players.json', { __meta__: {}, p1: { name: 'X' } });
  w(data, 'scorers.json', { __meta__: { updated_at: now }, s1: { name: 'Y' } });
  w(data, 'markets.json', { updated_at: now, tournament_winner: [{ team: 'France' }] });
  w(data, 'form.json', { __meta__: { updated_at: now }, f1: { x: 1 } });
  w(data, 'schedule_full.json', [{ match_id: 1 }]);
  w(data, 'actual_results.json', { group_stage: { x: 1 } });
  w(data, 'referees.json', { __meta__: { updated_at: now }, r1: { name: 'Z' } });
  const report = join(data, 'report.json');
  writeFileSync(report, JSON.stringify({ warnings: [] }) + '\n');
  const r = run(data, ['--validate-report', report]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(readFileSync(join(data, 'pipeline_status.json'), 'utf8'));
  assert.equal(out.health, 'ok', `all feeds ok + no warnings → ok; got ${JSON.stringify(out.feeds.filter(f=>f.status!=='ok'))}`);
});
