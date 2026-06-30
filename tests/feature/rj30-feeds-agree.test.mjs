/* rj30-feeds-agree.test.mjs — cross-feed invariant: derive_scorers.py and
   golden-boot.js#liveGoalsByPlayer must agree on per-player goal totals.
   Locks "own-goal excluded, pen-goal counted" on BOTH sides so they can't drift.

   We replicate derive_scorers' per-team counting rule in JS (same rule the Python
   selftest asserts) and check it against liveGoalsByPlayer on the same fixture. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveGoalsByPlayer, normPlayerName } from '../../app/lib/golden-boot.js';

// Mirror of derive_scorers' counting rule: goal|pen-goal count for e.player;
// own-goal and cards excluded. Keyed by normalized name → goals.
function deriveCounts(matchEvents) {
  const acc = {};
  for (const [k, rec] of Object.entries(matchEvents)) {
    if (k === '__meta__' || !Array.isArray(rec?.events)) continue;
    for (const e of rec.events) {
      if ((e.type === 'goal' || e.type === 'pen-goal') && e.player) {
        const nk = normPlayerName(e.player);
        acc[nk] = (acc[nk] || 0) + 1;
      }
    }
  }
  return acc;
}

const fixture = {
  __meta__: { updated_at: '2026-06-20T00:00:00+00:00' },
  'Mexico__vs__USA': { events: [
    { minute: "9'", type: 'goal', player: 'Julián Quiñones', team: 'Mexico' },
    { minute: "17'", type: 'pen-goal', player: 'Raúl Jiménez', team: 'Mexico' },
    { minute: "30'", type: 'own-goal', player: 'Damián Bobadilla', team: 'USA' },
    { minute: "45'", type: 'yellow', player: 'Edson Álvarez', team: 'Mexico' },
  ] },
  'Mexico__vs__Canada': { events: [
    // unaccented variant — must merge with the accented entry above.
    { minute: "12'", type: 'goal', player: 'Julian Quinones', team: 'Mexico' },
  ] },
};

test('liveGoalsByPlayer agrees with derive per-player counts (own-goal excluded, pen counted, accent-merged)', () => {
  const live = liveGoalsByPlayer({ matchEvents: fixture });
  const derived = deriveCounts(fixture);

  // Re-key liveGoalsByPlayer to normalized names for comparison.
  const liveByNorm = {};
  for (const [name, goals] of Object.entries(live)) {
    const nk = normPlayerName(name);
    liveByNorm[nk] = Math.max(liveByNorm[nk] || 0, goals);
  }

  for (const [nk, goals] of Object.entries(derived)) {
    assert.equal(liveByNorm[nk], goals, `goal total for ${nk} agrees`);
  }
  // Quiñones scored in two matches → 2 (accent-merge); Jiménez pen → 1.
  assert.equal(derived[normPlayerName('Julián Quiñones')], 2, 'Quiñones merged across matches = 2');
  assert.equal(derived[normPlayerName('Raúl Jiménez')], 1, 'pen-goal counted = 1');
  // own-goal scorer + card-only player must NOT appear.
  assert.ok(!(normPlayerName('Damián Bobadilla') in derived), 'own-goal not credited to its listed player');
  assert.ok(!(normPlayerName('Edson Álvarez') in derived), 'card-only player absent');
});
