/* r18-live-momentum.test.mjs — R18: live Match Momentum + the validated in-play
 * win-probability core. Pure-logic tests (no DOM): the tracker's per-minute
 * MAX-extremes aggregation + dedupe, ESPN summary parsing/orientation, the
 * prior→rates inversion, and the bounded SoT/red-card adjustments. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pressureDelta, createTracker } from '../../app/lib/momentum.js';
import { snapshotFromSummary } from '../../app/live-momentum.js';
import { liveWinProb, lambdasFromPrior, shotTilt } from '../../app/lib/win-prob.js';

// ---- momentum tracker ---------------------------------------------------------

test('pressureDelta: SoT burst dominates, sign follows the pressing side, clamped', () => {
  const base = { minute: 10, shotsA: 2, shotsB: 2, sotA: 1, sotB: 1, possA: 50 };
  const aBurst = { minute: 11, shotsA: 4, shotsB: 2, sotA: 3, sotB: 1, possA: 58 };
  const bBurst = { minute: 11, shotsA: 2, shotsB: 5, sotA: 1, sotB: 3, possA: 40 };
  assert.equal(pressureDelta(null, base), 0, 'first sample has no delta');
  const pa = pressureDelta(base, aBurst);
  const pb = pressureDelta(base, bBurst);
  assert.ok(pa > 0.4, `A burst strongly positive (got ${pa})`);
  assert.ok(pb < -0.4, `B burst strongly negative (got ${pb})`);
  assert.ok(pa <= 1 && pb >= -1, 'clamped to [-1,1]');
});

test('tracker keeps the per-minute MAX extreme, not the average (owner spec)', () => {
  const t = createTracker();
  // minute 10: a quiet tick, then a burst, then quiet again — the minute must
  // remember the BURST, which an average would wash out.
  t.addSample({ minute: 10, shotsA: 0, shotsB: 0, sotA: 0, sotB: 0, possA: 50 });
  t.addSample({ minute: 10, shotsA: 3, shotsB: 0, sotA: 2, sotB: 0, possA: 60 }); // burst
  t.addSample({ minute: 10, shotsA: 3, shotsB: 0, sotA: 2, sotB: 0, possA: 60 }); // identical → dedupe
  const s10 = t.series().find((r) => r.minute === 10);
  assert.ok(s10.value > 0.5, `minute keeps the burst extreme (got ${s10.value})`);
  // next minute: small opposite drift must NOT dilute minute 10
  t.addSample({ minute: 11, shotsA: 3, shotsB: 1, sotA: 2, sotB: 0, possA: 55 });
  assert.ok(t.series().find((r) => r.minute === 10).value === s10.value, 'past minute unchanged');
});

test('tracker dedupes identical consecutive payloads (10s ticks, slower ESPN refresh)', () => {
  const t = createTracker();
  assert.equal(t.addSample({ minute: 5, shotsA: 1, shotsB: 0, sotA: 1, sotB: 0, possA: 55 }), true);
  assert.equal(t.addSample({ minute: 5, shotsA: 1, shotsB: 0, sotA: 1, sotB: 0, possA: 55 }), false, 'identical tick ignored');
  assert.equal(t.series().length, 1);
});

// ---- ESPN summary parsing -------------------------------------------------------

function espnSummary({ home, away, clock = "63'", status = 'STATUS_IN_PROGRESS' }) {
  const teamBlock = (name, stats) => ({
    team: { displayName: name },
    statistics: Object.entries(stats).map(([n, v]) => ({ name: n, displayValue: String(v) })),
  });
  return {
    boxscore: { teams: [
      teamBlock(home.name, home.stats),
      teamBlock(away.name, away.stats),
    ] },
    header: { competitions: [{
      status: { type: { name: status }, displayClock: clock },
      competitors: [
        { team: { displayName: home.name }, score: String(home.score) },
        { team: { displayName: away.name }, score: String(away.score) },
      ],
    }] },
  };
}

test('snapshotFromSummary: orientation, renames, reds, minute', () => {
  const summary = espnSummary({
    home: { name: 'United States', score: 1, stats: { totalShots: 9, shotsOnTarget: 4, possessionPct: 57, redCards: 0 } },
    away: { name: 'Paraguay', score: 0, stats: { totalShots: 3, shotsOnTarget: 1, possessionPct: 43, redCards: 1 } },
  });
  // request orientation (USA = team_a) exercises the ESPN "United States" rename
  const snap = snapshotFromSummary(summary, 'USA', 'Paraguay');
  assert.equal(snap.minute, 63);
  assert.equal(snap.shotsA, 9);
  assert.equal(snap.sotB, 1);
  assert.equal(snap.scoreA, 1);
  assert.equal(snap.redB, 1);
  assert.equal(snap.final, false);
  // flipped orientation flips the sides
  const flipped = snapshotFromSummary(summary, 'Paraguay', 'USA');
  assert.equal(flipped.shotsA, 3);
  assert.equal(flipped.scoreB, 1);
});

// ---- in-play core: inversion + bounded adjustments ------------------------------

test('lambdasFromPrior round-trips: race at kickoff reproduces the prior', () => {
  for (const prior of [{ pa: 0.55, pd: 0.24, pb: 0.21 }, { pa: 0.2, pd: 0.28, pb: 0.52 }]) {
    const r = liveWinProb({ ...prior, scoreA: 0, scoreB: 0, minute: 0, stage: 'group' });
    assert.ok(Math.abs(r.a - prior.pa) < 0.02, `pa ${r.a} ≈ ${prior.pa}`);
    assert.ok(Math.abs(r.d - prior.pd) < 0.02, `pd ${r.d} ≈ ${prior.pd}`);
  }
});

test('red card shifts probability toward the full-strength side', () => {
  const base = { pa: 0.4, pd: 0.27, pb: 0.33, scoreA: 0, scoreB: 0, minute: 30, stage: 'group' };
  const noRed = liveWinProb(base);
  const bRed = liveWinProb({ ...base, redB: 1 });
  assert.ok(bRed.a > noRed.a, 'A gains when B goes down a man');
  assert.ok(bRed.b < noRed.b, 'B loses when short-handed');
});

test('SoT tilt is bounded: heavy pressure nudges but cannot flip a clear favorite', () => {
  const base = { pa: 0.62, pd: 0.22, pb: 0.16, scoreA: 0, scoreB: 0, minute: 40, stage: 'group' };
  const calm = liveWinProb(base);
  const bStorm = liveWinProb({ ...base, sotA: 0, sotB: 8 });   // B peppering the goal
  assert.ok(bStorm.b > calm.b, 'pressure raises the pressing side');
  assert.ok(bStorm.a > bStorm.b, 'but a 62/16 favorite is not flipped by shots alone');
  const { ta, tb } = shotTilt(0, 10, 1.35, 1.35);
  assert.ok(ta >= 0.75 && tb <= 1.25, 'tilt multipliers clamp at ±25%');
});

test('late lead is decisive under the Poisson core (validated backbone)', () => {
  const r = liveWinProb({ pa: 0.35, pd: 0.30, pb: 0.35, scoreA: 1, scoreB: 0, minute: 85, stage: 'group' });
  assert.ok(r.a > 0.80, `1-0 at 85' is a strong hold (got ${r.a})`);
  assert.ok(r.b < 0.03, 'comeback-to-WIN in 5 minutes is rare');
});
