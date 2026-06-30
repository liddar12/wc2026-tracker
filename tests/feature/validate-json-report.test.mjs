/* validate-json-report.test.mjs — RJ30-12: validate_data.py --json-report is a
   purely-additive sidecar. It writes {generated_at, warnings, errors,
   files_checked} AND must not change the exit code vs the same run without it
   (locks AC-12.5: no regression to the cron gate). Runs against a crafted temp
   dir so it's state-independent. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const ROOT = fileURLToPath(root);
const SCRIPT = join(ROOT, 'scripts/validate_data.py');

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'wc26-vjson-'));
  const data = join(dir, 'data');
  mkdirSync(data);
  // Copy the real data so the other checks pass; --now keeps it deterministic.
  cpSync(new URL('data', root).pathname, data, { recursive: true });
  return { dir, data };
}

function runValidate(data, extra = []) {
  return spawnSync('python3', [SCRIPT, '--data-dir', data, '--now', '2026-06-15', ...extra],
    { encoding: 'utf8' });
}

test('--json-report writes {generated_at, warnings, errors, files_checked}', () => {
  const { data } = fixtureDir();
  const report = join(data, 'validate_report.json');
  const r = runValidate(data, ['--json-report', report]);
  assert.ok(existsSync(report), `report written; stderr:\n${r.stderr}`);
  const rep = JSON.parse(readFileSync(report, 'utf8'));
  for (const k of ['generated_at', 'warnings', 'errors', 'files_checked']) {
    assert.ok(k in rep, `report has ${k}`);
  }
  assert.ok(Array.isArray(rep.warnings), 'warnings is an array');
  assert.ok(Array.isArray(rep.errors), 'errors is an array');
  assert.equal(typeof rep.files_checked, 'number');
});

test('adding --json-report does NOT change the exit code (no regression)', () => {
  const { data } = fixtureDir();
  const report = join(data, 'validate_report.json');
  const without = runValidate(data, []);
  const withReport = runValidate(data, ['--json-report', report]);
  assert.equal(withReport.status, without.status,
    `exit code stable with/without --json-report (${without.status} vs ${withReport.status})`);
});

test('--json-report captures warnings on a fixture that produces a warning', () => {
  const { data } = fixtureDir();
  // Force a warning: a composite outside the 0..110 sanity band warns (not errors).
  const teamsPath = join(data, 'teams.json');
  const teams = JSON.parse(readFileSync(teamsPath, 'utf8'));
  const firstKey = Object.keys(teams)[0];
  teams[firstKey].composite = 999;  // triggers a [warn], not an error
  writeFileSync(teamsPath, JSON.stringify(teams, null, 2) + '\n');
  const report = join(data, 'validate_report.json');
  const r = runValidate(data, ['--json-report', report, '--skip-feed-freshness']);
  const rep = JSON.parse(readFileSync(report, 'utf8'));
  assert.ok(rep.warnings.some((w) => /composite/.test(w)), `captured the composite warning; got ${JSON.stringify(rep.warnings)}`);
  // The warning must NOT be an error (exit stays 0 for a warn-only run).
  assert.equal(r.status, 0, 'a warn-only run still exits 0');
});
