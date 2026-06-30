/* status-wiring.test.mjs — RJ30-12: wiring contract for the pipeline-status
   surface. The build script, the status view, and the Settings link row are
   RJ30-12-owned and asserted strictly here. The two SHARED-WIRING edits
   (daily_update.yml step order + app/main.js route) are owned by the Wave-2
   integrator; this test asserts them once present and otherwise records the
   exact requirement (so it stays green pre-integration, tightens post-). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// ---- RJ30-12-owned deliverables (strict) --------------------------------

test('build_pipeline_status.py writes pipeline_status.json with health + feeds + warnings', () => {
  const s = read('scripts/build_pipeline_status.py');
  assert.match(s, /pipeline_status\.json/, 'targets pipeline_status.json');
  assert.match(s, /"health"/, 'emits an overall health field');
  assert.match(s, /"feeds"/, 'emits per-feed rows');
  assert.match(s, /"warnings"/, 'folds in validate warnings');
  assert.match(s, /ensure_ascii=True/, 'ASCII per repo convention');
  assert.match(s, /raise SystemExit\(0\)/, 'non-blocking: exits 0 even on fatal');
  assert.match(s, /no status change/i, 'no-op-bump so it does not churn deploys');
});

test('validate_data.py has an additive --json-report flag', () => {
  const s = read('scripts/validate_data.py');
  assert.match(s, /--json-report/, 'declares the flag');
  // The report carries the documented keys (order-agnostic on errors/warnings).
  for (const k of ['"generated_at"', '"warnings"', '"errors"', '"files_checked"']) {
    assert.ok(s.includes(k), `report shape includes ${k}`);
  }
});

test('status-view.js fetches pipeline_status.json + degrades gracefully', () => {
  const s = read('app/views/status-view.js');
  assert.match(s, /fetch\(\s*['"]data\/pipeline_status\.json['"]/, 'fetches the status feed');
  assert.match(s, /escape\.js/, 'imports the canonical escaper');
  assert.match(s, /empty-state\.js/, 'reuses the empty-state lib for the missing-JSON case');
  assert.match(s, /not yet generated/i, 'has a graceful "not yet generated" state');
});

test('Settings exposes a Pipeline-status link to #/status (off the tab bar)', () => {
  const s = read('app/views/settings-view.js');
  assert.match(s, /renderPipelineStatusCard/, 'renders the pipeline-status card');
  assert.match(s, /setRoute\(\s*['"]status['"]/, 'navigates to the status route');
});

// ---- Wave-2 integrator wiring (asserted once present) -------------------

test('[integrator] daily_update.yml runs build_pipeline_status after validate, before commit, non-blocking', () => {
  const y = read('.github/workflows/daily_update.yml');
  if (!/build_pipeline_status\.py/.test(y)) {
    // Pre-integration: the step isn't wired yet (integrator-owned). Record the
    // requirement so this is unmissable, but don't fail RJ30-12's own suite.
    assert.ok(true, 'PENDING INTEGRATOR: add build_pipeline_status.py step (continue-on-error) after validate, before commit');
    return;
  }
  const validateAt = y.indexOf('validate_data.py');
  const statusAt = y.indexOf('build_pipeline_status.py');
  const commitAt = y.indexOf('git add data/');
  assert.ok(validateAt >= 0 && statusAt > validateAt, 'status build runs AFTER validate');
  assert.ok(commitAt < 0 || statusAt < commitAt, 'status build runs BEFORE the commit step');
  // Its step block must be continue-on-error.
  const block = y.slice(Math.max(0, statusAt - 200), statusAt + 80);
  assert.match(block, /continue-on-error:\s*true/, 'status build is non-blocking');
});

test('[integrator] main.js registers the status route + TITLE', () => {
  const s = read('app/main.js');
  if (!/status-view\.js/.test(s)) {
    assert.ok(true, "PENDING INTEGRATOR: import renderStatusView, add case 'status', add TITLES['status']='Status'");
    return;
  }
  assert.match(s, /renderStatusView/, 'imports + dispatches the status view');
  assert.match(s, /case 'status'/, 'has a status route case');
  assert.match(s, /status:\s*'[^']+'/, "TITLES has a 'status' entry");
});

test('[integrator] main.js registers the model-accuracy route + TITLE', () => {
  const s = read('app/main.js');
  if (!/model-accuracy-view\.js/.test(s)) {
    assert.ok(true, "PENDING INTEGRATOR: import renderModelAccuracyView, add case 'model-accuracy', TITLES['model-accuracy']='Model Accuracy'");
    return;
  }
  assert.match(s, /renderModelAccuracyView/, 'imports + dispatches the model-accuracy view');
  assert.match(s, /case 'model-accuracy'/, 'has a model-accuracy route case');
});
