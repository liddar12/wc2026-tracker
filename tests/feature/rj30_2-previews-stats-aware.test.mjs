/* rj30_2-previews-stats-aware.test.mjs — RJ30.2 (AI, Wave-1 C). Proves
   generate_previews.py folds data/match_stats.json into the RECAP prompt while
   staying byte-for-byte DORMANT with no ANTHROPIC_API_KEY (unchanged from
   RJ30.1). No network, no SDK, no key — a python inline harness drives the pure
   helpers so we don't depend on Wave-1 A's data/match_stats.json existing yet. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const SCRIPT = resolve(ROOT, 'scripts/generate_previews.py');
const PREVIEWS = resolve(ROOT, 'data/previews.json');

test('--self-test still passes (stats path covered, no network/SDK/key)', () => {
  const out = execFileSync('python3', [SCRIPT, '--self-test'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /selftest: PASS/, out);
});

test('DORMANT unchanged: no key → exit 0, previews.json byte-identical', () => {
  const before = readFileSync(PREVIEWS);
  const beforeMtime = statSync(PREVIEWS).mtimeMs;
  execFileSync('python3', [SCRIPT],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '' } });
  assert.ok(before.equals(readFileSync(PREVIEWS)), 'bytes unchanged');
  assert.equal(statSync(PREVIEWS).mtimeMs, beforeMtime, 'not rewritten');
});

test('source wires match_stats into the recap prompt (stats-aware)', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /match_stats\.json/, 'loads the stats feed');
  assert.match(src, /_match_stats_summary/, 'has the stats summary helper');
  assert.match(src, /stats_/, 'emits typed stats_* prompt fields');
  // The recap system nudge must NOT leak into the preview variant (cache-stable).
  assert.match(src, /kind == "recap"/, 'recap-only stats nudge');
});

test('collect_inputs folds real stats into a recap; preview stays stats-free', () => {
  // Drive the pure helpers with an inline fixture (no shared files touched).
  const py = `
import sys, json
sys.path.insert(0, 'scripts')
import generate_previews as g

feeds = {
  "matchups": {"A__vs__B": {"team_a": "A", "team_b": "B", "stage": "group"}},
  "sched_rows": {"A__vs__B": {"venue_id": None}},
  "xg": {}, "form": {}, "h2h": {}, "scorers": {}, "weather": {},
  "results": {"A__vs__B": {"score_a": 3, "score_b": 0, "status": "STATUS_FULL_TIME"}},
  "match_stats": {"A__vs__B": {
      "team_a": {"possessionPct": 61, "totalShots": 14, "shotsOnTarget": 6, "passPct": 87},
      "team_b": {"possessionPct": 39, "totalShots": 4, "shotsOnTarget": 1, "passPct": 71}}},
}
recap = g.collect_inputs("A__vs__B", "recap", feeds=feeds)
assert recap.get("stats_possessionPct_a") == 61, recap
assert recap.get("stats_shotsOnTarget_b") == 1, recap
assert recap.get("final_score_a") == 3, recap

# A preview must NOT carry stats_* fields (recap-only enrichment).
feeds["results"] = {}
prev = g.collect_inputs("A__vs__B", "preview", feeds=feeds)
assert not any(k.startswith("stats_") for k in (prev or {})), prev

# The recap prompt actually surfaces the stat lines to the model.
sys_text, user_text = g.build_prompt("recap", recap)
assert "stats_possessionPct_a: 61" in user_text, user_text
assert "possession" in sys_text.lower() or "passing" in sys_text.lower(), sys_text

# Absent stats → recap still works, just no stats_* keys (no zero-fill).
feeds2 = dict(feeds)
feeds2["match_stats"] = {}
feeds2["results"] = {"A__vs__B": {"score_a": 1, "score_b": 1, "status": "STATUS_FULL_TIME"}}
r2 = g.collect_inputs("A__vs__B", "recap", feeds=feeds2)
assert not any(k.startswith("stats_") for k in r2), r2
print("OK")
`;
  const out = execFileSync('python3', ['-c', py], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /OK/, out);
});
