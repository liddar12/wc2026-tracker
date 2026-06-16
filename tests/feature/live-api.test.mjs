/* live-api.test.mjs — Phase 1 of docs/REALTIME_ARCHITECTURE.md: the Vercel
   /api/live read-through endpoint + the client adapter that prefers it and
   falls back to direct ESPN. Locks the contract that the endpoint's `board`
   shape is exactly what mergeLiveScores() consumes, and that the flag is OFF
   by default. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScoreboard } from '../../live-api/api/live.js';
import { mergeLiveScores } from '../../app/live-scores.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// Minimal ESPN-shaped fixture (France 3-1 final, hyphenated Bosnia in-progress).
const ESPN = {
  events: [
    { competitions: [{
      status: { displayClock: "90'", type: { name: 'STATUS_FULL_TIME', state: 'post' } },
      competitors: [
        { team: { displayName: 'France' }, score: '3' },
        { team: { displayName: 'Senegal' }, score: '1' },
      ],
    }] },
    { competitions: [{
      status: { displayClock: "26'", type: { name: 'STATUS_FIRST_HALF', state: 'in' } },
      competitors: [
        { team: { displayName: 'Canada' }, score: '0' },
        { team: { displayName: 'Bosnia-Herzegovina' }, score: '1' },
      ],
    }] },
  ],
};

test('Edge parseScoreboard emits the board shape mergeLiveScores expects', () => {
  const board = parseScoreboard(ESPN);
  const fr = board.find((b) => b.teams.France != null);
  assert.deepEqual(fr, { teams: { France: 3, Senegal: 1 }, status: 'STATUS_FULL_TIME', minute: '' });
  // hyphenated Bosnia normalized to canonical, clock apostrophe stripped
  const ca = board.find((b) => b.teams.Canada != null);
  assert.equal(ca.teams['Bosnia and Herzegovina'], 1);
  assert.equal(ca.minute, '26');

  // and that board feeds straight into mergeLiveScores
  const data = {
    scheduleFull: [{ team_a: 'France', team_b: 'Senegal', stage: 'group', kickoff_utc: '2026-06-16T19:00:00Z' }],
    actualResults: { group_stage: {} },
  };
  assert.equal(mergeLiveScores(data, board), 1);
  assert.equal(data.actualResults.group_stage['France__vs__Senegal'].score_a, 3);
});

test('client prefers /api/live when configured, falls back to ESPN on error', async () => {
  const realFetch = globalThis.fetch;
  try {
    // 1) endpoint configured + healthy → board comes from /api/live
    globalThis.window = { __WC26_LIVE_API_URL: 'https://wc26-live.test/api/live' };
    let hit = '';
    globalThis.fetch = async (url) => {
      hit = String(url);
      return { ok: true, json: async () => ({ board: [{ teams: { France: 3, Senegal: 1 }, status: 'STATUS_FULL_TIME', minute: '' }] }) };
    };
    // fresh import so module-level LIVE_API_URL picks up window
    const mod = await import('../../app/live-scores.js?case=api');
    const board = await mod.fetchEspnLive();
    assert.match(hit, /wc26-live\.test/, 'read the configured endpoint');
    assert.equal(board[0].teams.France, 3);

    // 2) endpoint errors → falls back to direct ESPN
    let calledEspn = false;
    globalThis.fetch = async (url) => {
      if (String(url).includes('wc26-live.test')) throw new Error('down');
      calledEspn = true;
      return { ok: true, json: async () => ESPN };
    };
    const board2 = await mod.fetchEspnLive();
    assert.ok(calledEspn, 'fell back to ESPN');
    assert.ok(board2.find((b) => b.teams.France === 3), 'ESPN fallback returned the board');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.window;
  }
});

test('flag is OFF by default + CORS limited to prod origin', () => {
  const ls = read('app/live-scores.js');
  assert.match(ls, /window\.__WC26_LIVE_API_URL\) \|\| ''/, 'defaults to empty (off)');
  const fn = read('live-api/api/live.js');
  assert.match(fn, /worldcup2026\.j5lagenticstrategy\.com/, 'CORS pinned to prod origin');
  assert.match(fn, /s-maxage=10/, 'edge-cached 10s');
  assert.match(fn, /runtime: 'edge'/, 'edge runtime');
});
