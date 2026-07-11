/* conformal.js — R20: split-conformal "safe sets" over the default model's
 * match predictions. Pure logic; the calibration threshold comes from
 * data/conformal.json (scripts/build_conformal.py, re-fit each cron as scored
 * matches accrue). Display-only: never changes a pick.
 *
 * A match's safe set at the display level (85%) is every outcome whose
 * predicted probability clears the calibrated threshold — the top pick is
 * always included so a set is never empty. Empirically this is the principled
 * version of the "draw-as-win" framing: confident favorites get a one-outcome
 * set; close matches widen to {win, draw} or all three.
 */

export const OUTCOME_KEYS = ['team_a', 'draw', 'team_b'];

/** Threshold for the shipped display level, or null when uncalibrated. */
export function conformalThreshold(conformal) {
  const lv = conformal?.display_level;
  const t = conformal?.levels?.[lv]?.threshold;
  return Number.isFinite(t) && t > 0 && t < 1 ? t : null;
}

/**
 * The safe set for a 3-way distribution.
 * @param {number[]} triplet [pA, pDraw, pB] fractions summing ~1
 * @param {number} threshold calibrated probability floor
 * @returns {string[]} subset of OUTCOME_KEYS, ordered by probability desc;
 *   never empty (the top pick is always included).
 */
export function predictionSet(triplet, threshold) {
  if (!Array.isArray(triplet) || triplet.length !== 3 || !Number.isFinite(threshold)) return [];
  const ranked = OUTCOME_KEYS
    .map((k, i) => ({ k, p: Number(triplet[i]) || 0 }))
    .sort((x, y) => y.p - x.p);
  const set = ranked.filter((r) => r.p >= threshold).map((r) => r.k);
  return set.length ? set : [ranked[0].k];
}

/** Human label for a safe set, e.g. "France or draw", "any result". */
export function safeSetLabel(set, teamA, teamB) {
  const name = (k) => (k === 'team_a' ? teamA : k === 'team_b' ? teamB : 'draw');
  if (!set || !set.length) return '';
  if (set.length === 3) return 'any result';
  return set.map(name).join(' or ');
}
