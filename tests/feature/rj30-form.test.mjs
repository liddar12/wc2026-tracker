/* rj30-form.test.mjs — RJ30-8 results-derived recent form (no network).
 *
 * Locks compute_form_recent.py: derives last-5 W/D/L per team from
 * actual_results.json, most-recent first, capped at 5, orientation correct,
 * and pen/AET ties resolved via `winner` (W/L, never D). Also locks the
 * composite form-weight floor in rebuild_composite.py and confirms the two
 * "form" signals stay separate (form.json vs teams.json.form_scaled), and that
 * scrape_form.py is unwired/retired.
 *
 * Integrator-owned assertions (workflow YAML wiring, validate_data coverage)
 * are { skip }-marked until Wave-2 wires them — see INTEGRATOR NEEDS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('compute_form_recent.py --selftest passes (exit 0, no network)', () => {
  const out = execFileSync('python3', [resolve(ROOT, 'scripts/compute_form_recent.py'), '--selftest'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /selftest: PASS/, out);
});

test('form.json shape: every team is an array len ≤ 5 of valid, date-desc entries', () => {
  const form = JSON.parse(read('data/form.json'));
  const teams = Object.keys(form).filter((k) => k !== '__meta__');
  assert.ok(teams.length >= 1, 'form.json must be populated (not dark)');
  for (const t of teams) {
    const rows = form[t];
    assert.ok(Array.isArray(rows), `${t} must be an array`);
    assert.ok(rows.length <= 5, `${t} capped at 5, got ${rows.length}`);
    for (const e of rows) {
      assert.ok(['W', 'D', 'L'].includes(e.result), `${t} bad result ${e.result}`);
      assert.equal(typeof e.date, 'string');
      assert.equal(typeof e.opponent, 'string');
      assert.equal(typeof e.score_a, 'number');
      assert.equal(typeof e.score_b, 'number');
    }
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].date >= rows[i].date, `${t} must be sorted most-recent first`);
    }
  }
});

test('orientation: a known result is oriented to each team (Mexico 2–0 South Africa)', () => {
  const form = JSON.parse(read('data/form.json'));
  const mx = (form['Mexico'] || []).find((e) => e.opponent === 'South Africa');
  const sa = (form['South Africa'] || []).find((e) => e.opponent === 'Mexico');
  assert.ok(mx, 'Mexico must carry the South Africa result');
  assert.deepEqual({ a: mx.score_a, b: mx.score_b, r: mx.result }, { a: 2, b: 0, r: 'W' });
  assert.ok(sa, 'South Africa must mirror the Mexico result');
  assert.deepEqual({ a: sa.score_a, b: sa.score_b, r: sa.result }, { a: 0, b: 2, r: 'L' });
});

test('pen winner gets W and loser L (regulation score shown) — Germany 1–1 Paraguay (PEN)', () => {
  const form = JSON.parse(read('data/form.json'));
  const pg = (form['Paraguay'] || []).find((e) => e.opponent === 'Germany');
  const de = (form['Germany'] || []).find((e) => e.opponent === 'Paraguay');
  assert.ok(pg && de, 'both sides of the pen game must appear');
  assert.equal(pg.result, 'W', 'shootout winner is W (not D)');
  assert.equal(de.result, 'L', 'shootout loser is L (not D)');
  // Displayed scores are REGULATION (1–1), oriented to each team.
  assert.deepEqual([pg.score_a, pg.score_b], [1, 1]);
  assert.deepEqual([de.score_a, de.score_b], [1, 1]);
});

test('compute_form_recent writes ONLY form.json (never teams.json — two-form separation)', () => {
  const s = read('scripts/compute_form_recent.py');
  assert.match(s, /save\(\s*["']form\.json["']/, 'must write form.json');
  assert.ok(!/teams\.json["']\s*,\s*[a-z]/i.test(s) || !s.includes('save("teams.json"'),
    'must NOT write teams.json (that is compute_form.py\'s form_scaled signal)');
  assert.ok(!s.includes('save("teams.json")') && !s.includes("save('teams.json')"),
    'compute_form_recent must not write teams.json');
});

test('compute_form.py still owns the SEPARATE teams.json.form_scaled signal', () => {
  const s = read('scripts/compute_form.py');
  assert.match(s, /form_scaled/, 'compute_form.py writes sub_ratings.form_scaled');
  assert.match(s, /teams\.json/, 'compute_form.py writes teams.json');
});

test('rebuild_composite.py floors the form weight (never exactly inert)', () => {
  const s = read('scripts/rebuild_composite.py');
  assert.match(s, /FORM_WEIGHT_FLOOR\s*=/, 'must define a FORM_WEIGHT_FLOOR constant');
  // The floored expression max(weights.get("form", 0), FORM_WEIGHT_FLOOR) must
  // appear (live or as the documented equivalence of the additive top-up).
  assert.match(s, /max\(\s*weights\.get\(\s*["']form["']\s*,\s*0\s*\)\s*,\s*FORM_WEIGHT_FLOOR\s*\)/,
    'composite() must apply max(weights.get("form", 0), FORM_WEIGHT_FLOOR)');
});

test('rebuild_composite.composite() applies the form-weight floor (behavioral)', () => {
  // Prove the floor genuinely fires: a near-zero optimizer weight still moves
  // the composite by FORM_WEIGHT_FLOOR * form_scaled (not by ~0).
  const driver = [
    'import sys; sys.path.insert(0, "scripts")',
    'import rebuild_composite as rc',
    't = {"sub_ratings": {"form_scaled": 80}}',
    'lo = rc.composite(t, {"mine":0,"elo":0,"tmv":0,"qual":0,"form":0.0})',
    'zero = rc.composite(t, {"mine":0,"elo":0,"tmv":0,"qual":0,"form":0.0037})',
    'hi = rc.composite(t, {"mine":0,"elo":0,"tmv":0,"qual":0,"form":0.05})',
    'print(rc.FORM_WEIGHT_FLOOR, lo, zero, hi)',
  ].join('\n');
  const out = execFileSync('python3', ['-c', driver], { cwd: ROOT, encoding: 'utf8' }).trim();
  const [floor, lo, zeroW, hi] = out.split(/\s+/).map(Number);
  // form=0 and form=0.0037 both floor to FLOOR → identical, ≈ FLOOR*80.
  assert.equal(lo, zeroW, 'sub-floor weights all clamp to the same floored value');
  assert.ok(Math.abs(lo - floor * 80) < 1e-6, `floored term = FLOOR*form_scaled, got ${lo}`);
  // An above-floor optimizer weight wins (0.05*80 = 4.0 > floored 0.8).
  assert.ok(hi > lo, 'optimizer weight above the floor takes over');
});

test('scrape_form.py is RETIRED (unwired, safe no-op without --force)', () => {
  const s = read('scripts/scrape_form.py');
  assert.match(s, /RETIRED/, 'docstring/guard must mark the legacy scraper retired');
  assert.match(s, /--force/, 'must require --force to run the legacy ESPN path');
});

test('compute_xg.py consumes form.json (recent-form xG bump source)', () => {
  const s = read('scripts/compute_xg.py');
  assert.match(s, /form\.json/, 'compute_xg reads form.json for form_points()');
});

/* INTEGRATOR-OWNED (workflow YAMLs + validate_data.py are Wave-2 territory).
 * Unskip once the integrator swaps scrape_form → compute_form_recent in the
 * crons and adds check_form_coverage(). See INTEGRATOR NEEDS. */
for (const wf of ['daily_update.yml', 'frequent_update.yml', 'live_update.yml']) {
  test(`${wf} runs compute_form_recent and NOT scrape_form`,
    { skip: 'integrator wires the workflow YAMLs' }, () => {
      const y = read(`.github/workflows/${wf}`);
      assert.match(y, /compute_form_recent\.py/);
      assert.ok(!y.includes('scrape_form.py'));
    });
}

test('validate_data.py has a warn-only form coverage check',
  { skip: 'integrator wires validate_data.py' }, () => {
    const s = read('scripts/validate_data.py');
    assert.match(s, /check_form_coverage|form.*coverage/);
    assert.match(s, /self\.warnings\.append/);
  });
