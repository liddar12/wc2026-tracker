/* momentum.js — R18: "Match Momentum" pressure tracking for a live match.
 *
 * Design (owner spec): sample the live boxscore fast (~10s ticks), aggregate
 * per MINUTE by the MAXIMUM-magnitude pressure sample in that minute — the
 * extremes, not the average, so a burst of pressure isn't washed out by the
 * quiet seconds around it. ESPN's stats refresh slower than 10s, so identical
 * consecutive payloads are deduped (a repeated sample adds no new extreme).
 *
 * Pressure is a signed value in [-1, 1], positive = team A pressing, built
 * from the DELTAS between consecutive samples: shots-on-target carry the most
 * weight, then shots, then possession swing. Goals/cards are not part of the
 * pressure value (they're plotted as timeline markers and already move the
 * win probability directly).
 *
 * Pure logic — no fetching, no DOM. app/live-momentum.js owns the sampling.
 */

const W_SOT = 0.55, W_SHOT = 0.30, W_POSS = 0.15;
// Normalizers: one SoT in a window is a big burst; possession swings are %pts.
const SOT_FULL = 2, SHOT_FULL = 3, POSS_FULL = 20;

function clamp1(v) { return Math.max(-1, Math.min(1, v)); }

/** Signed pressure from two consecutive snapshots (A-positive).
 *  Snapshot: { minute, shotsA, shotsB, sotA, sotB, possA } (counts cumulative,
 *  possA in 0-100). Returns 0 for the first sample or a no-change tick. */
export function pressureDelta(prev, cur) {
  if (!prev || !cur) return 0;
  const dSotA = Math.max(0, (cur.sotA || 0) - (prev.sotA || 0));
  const dSotB = Math.max(0, (cur.sotB || 0) - (prev.sotB || 0));
  const dShA = Math.max(0, (cur.shotsA || 0) - (prev.shotsA || 0));
  const dShB = Math.max(0, (cur.shotsB || 0) - (prev.shotsB || 0));
  const dPoss = (cur.possA ?? 50) - (prev.possA ?? 50);
  const sot = clamp1((dSotA - dSotB) / SOT_FULL);
  const shot = clamp1((dShA - dShB) / SHOT_FULL);
  const poss = clamp1(dPoss / POSS_FULL);
  return clamp1(W_SOT * sot + W_SHOT * shot + W_POSS * poss);
}

export function createTracker() {
  let prev = null;
  let prevKey = '';
  const byMinute = new Map();   // minute -> signed max-|pressure| sample

  return {
    /** Feed one snapshot (any cadence). Returns true if it produced a new
     *  reading (false for deduped/no-op ticks). */
    addSample(snap) {
      if (!snap || !Number.isFinite(snap.minute)) return false;
      // dedupe: ESPN updates slower than we poll — identical stats add nothing
      const key = [snap.shotsA, snap.shotsB, snap.sotA, snap.sotB, snap.possA].join('|');
      if (key === prevKey && byMinute.has(Math.floor(snap.minute))) return false;
      const p = pressureDelta(prev, snap);
      const min = Math.floor(snap.minute);
      const cur = byMinute.get(min);
      // keep the EXTREME of the minute: max |pressure|, sign preserved
      if (cur === undefined || Math.abs(p) > Math.abs(cur)) byMinute.set(min, p);
      prev = snap;
      prevKey = key;
      return true;
    },
    /** Per-minute signed extremes, ascending minutes: [{minute, value}] */
    series() {
      return [...byMinute.entries()].sort((x, y) => x[0] - y[0])
        .map(([minute, value]) => ({ minute, value }));
    },
    /** Latest minute's extreme (the "now" needle), 0 when no data. */
    current() {
      const s = this.series();
      return s.length ? s[s.length - 1].value : 0;
    },
  };
}
