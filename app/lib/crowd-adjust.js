/* crowd-adjust.js — transparent per-match "crowd factor" layer.
 *
 * A KNOWN, extreme crowd asymmetry (e.g. a 3:1 partisan majority at a neutral
 * final) is something the self-learning core CANNOT learn — backtested on the
 * 28 played knockouts a crowd term is indistinguishable from noise
 * (permutation p=0.33; docs/CROWD_ANALYSIS.md). But home/crowd advantage is a
 * well-replicated real effect, so for a match whose crowd split is known we
 * apply a FIXED, literature-anchored prior as a labelled layer ON TOP of the
 * model's probability — never baked into the learned weights, scoring, or
 * bracket.
 *
 * Magnitude anchor (the "ghost games" natural experiment): the crowd-attributable
 * share of home advantage is ~1/3-1/2 of the full ~0.35-goal effect. A 3:1
 * (~75% support) partisan majority ~ a normal home crowd's tilt -> ~0.15 goals
 * of expected-goal supremacy toward the supported side (the "central"
 * calibration). We map the reported support RATIO to that delta and shift the
 * displayed two-way probability by re-solving the bivariate-Poisson the model
 * itself uses (MU/BETA mirror app/lib/model-pick.js).
 */

const MU = 0.30;
const BETA = 0.70;
// delta-goals at a 3:1 (75% support) majority — the "central" ghost-game anchor.
const CENTRAL_DELTA = 0.15;
const CALIBRATION_DELTA = { conservative: 0.10, central: 0.15, strong: 0.20, aggressive: 0.25 };

const LOG_FACT = [0];
for (let k = 1; k <= 11; k++) LOG_FACT[k] = LOG_FACT[k - 1] + Math.log(k);
const pois = (k, lam) => Math.exp(k * Math.log(lam) - lam - LOG_FACT[k]);

/** Two-way advance prob for team A from expected goals (draw split evenly). */
function twoWayFromLambdas(la, lb) {
  const pa = []; const pb = [];
  for (let k = 0; k <= 10; k++) { pa[k] = pois(k, la); pb[k] = pois(k, lb); }
  let h = 0; let d = 0; let a = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = pa[i] * pb[j];
      if (i > j) h += p; else if (i === j) d += p; else a += p;
    }
  }
  const t = h + d + a || 1;
  return (h + d / 2) / t;
}

export function twoWayFromGap(gap) {
  const sup = BETA * gap;
  return twoWayFromLambdas(Math.exp(MU + sup / 2), Math.exp(MU - sup / 2));
}

/** Invert twoWayFromGap: strength gap implied by a base advance probability. */
function gapForProb(p) {
  p = Math.min(0.999, Math.max(0.001, p));
  let lo = -6; let hi = 6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (twoWayFromGap(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** delta-goals of expected-goal supremacy for a support ratio (>=1) at the
 *  given calibration. 1:1 -> 0; 3:1 -> the calibration's delta; capped past ~9:1. */
export function deltaGoalsForRatio(ratio, calibration = 'central') {
  const full = CALIBRATION_DELTA[calibration] ?? CENTRAL_DELTA;
  const r = Math.max(1, Number(ratio) || 1);
  const share = r / (r + 1);                 // 3:1 -> 0.75
  const frac = Math.min(1.4, (share - 0.5) / 0.25); // 0.75 -> 1.0 (=full); cap
  return Math.max(0, full * frac);
}

/** Look up the crowd entry for a pairing, either orientation. */
export function crowdEntryFor(data, a, b) {
  const c = data?.crowd;
  if (!c || !a || !b) return null;
  return c[`${a}__vs__${b}`] || c[`${b}__vs__${a}`] || null;
}

/**
 * Crowd-adjusted two-way for a match, anchored to the model's displayed
 * advance % when present (else the stack two-way). Returns null when there is
 * no crowd entry or the base probability can't be established.
 *
 * Shape: { favoredTeam, otherTeam, ratio, deltaGoals, source, note,
 *          base: {[team]: pct}, adjusted: {[team]: pct}, deltaPct } (pct = 0..100)
 */
export function crowdAdjustment(data, match) {
  const a = match?.team_a; const b = match?.team_b;
  const entry = crowdEntryFor(data, a, b);
  if (!entry || !a || !b) return null;
  const favored = entry.favored;
  if (favored !== a && favored !== b) return null;

  // Base advance prob for team A: prefer the model's displayed advance_pct,
  // fall back to the stack two-way so the layer still works pre-forecast.
  let pA = null;
  if (typeof match.advance_pct_a === 'number') pA = match.advance_pct_a / 100;
  else {
    const s = data?.stacker?.strengths || {};
    if (typeof s[a] === 'number' && typeof s[b] === 'number') pA = twoWayFromGap(s[a] - s[b]);
  }
  if (pA == null) return null;

  const delta = deltaGoalsForRatio(entry.ratio, entry.calibration || 'central');
  // Re-solve the two-way from the implied gap, then shift expected goals toward
  // the crowd-favored side by delta (split +/- delta/2 across the two lambdas).
  const gap0 = gapForProb(pA);            // + favors A
  const sup0 = BETA * gap0;
  let la = Math.exp(MU + sup0 / 2);       // team A expected goals
  let lb = Math.exp(MU - sup0 / 2);       // team B expected goals
  if (favored === a) { la += delta / 2; lb = Math.max(0.05, lb - delta / 2); }
  else { lb += delta / 2; la = Math.max(0.05, la - delta / 2); }
  const pAadj = twoWayFromLambdas(la, lb);

  const r2 = (x) => Math.round(x * 1000) / 10;
  return {
    favoredTeam: favored,
    otherTeam: favored === a ? b : a,
    ratio: entry.ratio,
    deltaGoals: Math.round(delta * 100) / 100,
    source: entry.source || null,
    note: entry.note || null,
    base: { [a]: r2(pA), [b]: r2(1 - pA) },
    adjusted: { [a]: r2(pAadj), [b]: r2(1 - pAadj) },
    deltaPct: Math.round(Math.abs(pAadj - pA) * 1000) / 10,
  };
}
