/* results-health-core.mjs — R15b (#44) DRAFT.
   Pure, dependency-free health logic so it can be unit-tested without Netlify
   or the network. The Netlify function (results-health.mjs) fetches the live
   data files and calls computeResultsHealth(); the test feeds fixtures.

   What it guards: once the tournament is live, actual_results.json must keep
   getting refreshed by the data pipeline, or scoring silently freezes on stale
   scores and nobody notices. This flags (a) stale data_version and (b) an empty
   results set for the phase that should currently have results. */

// Real WC26 boundaries (same values seeded into tournament_config for #21).
export const LOCK_BOUNDS = {
  firstGroupKickoff: Date.parse('2026-06-11T19:00:00Z'),
  lastGroupKickoff: Date.parse('2026-06-28T02:00:00Z'),
  firstR32Kickoff: Date.parse('2026-06-28T19:00:00Z'),
  groupEndGraceMs: 2 * 60 * 60 * 1000,
};

// Mirrors deriveLockState() phase names so health reports line up with the app.
export function phaseAt(nowMs, bounds = LOCK_BOUNDS) {
  const groupEnd = bounds.lastGroupKickoff + bounds.groupEndGraceMs;
  if (nowMs < bounds.firstGroupKickoff) return 'pre-tournament';
  if (nowMs <= groupEnd) return 'group-stage-live';
  if (nowMs < bounds.firstR32Kickoff) return 'between-group-and-r32';
  return 'r32-live';
}

// The actual_results stage key that should be populating during each phase.
function expectedStageForPhase(phase) {
  if (phase === 'group-stage-live') return 'group_stage';
  if (phase === 'r32-live') return 'round_of_32'; // earliest knockout; later rounds fill in over time
  return null; // pre-tournament / gap window: nothing required yet
}

function countPopulated(stageObj) {
  if (!stageObj || typeof stageObj !== 'object') return 0;
  // A populated match has a non-empty value (score object / array / etc.).
  return Object.values(stageObj).filter((v) => {
    if (v == null) return false;
    if (typeof v === 'object') return Object.keys(v).length > 0 || Array.isArray(v) && v.length > 0;
    return true;
  }).length;
}

/**
 * @param {object} meta    parsed data/meta.json (uses .data_version)
 * @param {object} results parsed data/actual_results.json (stage objects + last_updated)
 * @param {number} nowMs   current time in ms
 * @param {object} [opts]  { staleHours=12, bounds }
 * @returns {{ok, phase, dataVersion, ageHours, stale, emptyDuringLive, counts, reasons, checkedAt}}
 */
export function computeResultsHealth(meta, results, nowMs, opts = {}) {
  const staleHours = opts.staleHours ?? 12;
  const bounds = opts.bounds ?? LOCK_BOUNDS;
  const phase = phaseAt(nowMs, bounds);
  const live = phase === 'group-stage-live' || phase === 'r32-live' || phase === 'between-group-and-r32';

  // Freshness: prefer actual_results.last_updated, fall back to meta.data_version.
  const versionStr = results?.last_updated || meta?.data_version || null;
  const versionMs = versionStr ? Date.parse(versionStr) : NaN;
  const ageHours = Number.isFinite(versionMs) ? (nowMs - versionMs) / 3_600_000 : null;

  const counts = {};
  for (const k of ['group_stage', 'round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final']) {
    counts[k] = countPopulated(results?.[k]);
  }

  const reasons = [];
  // (a) Staleness only matters once we're live.
  const stale = live && (ageHours == null || ageHours > staleHours);
  if (stale) {
    reasons.push(ageHours == null
      ? 'No parseable last_updated/data_version timestamp while tournament is live.'
      : `Data is ${ageHours.toFixed(1)}h old (> ${staleHours}h) during ${phase}.`);
  }

  // (b) Expected stage must have at least one populated result while live.
  const expectStage = expectedStageForPhase(phase);
  const emptyDuringLive = !!expectStage && counts[expectStage] === 0;
  if (emptyDuringLive) {
    reasons.push(`Phase ${phase} expects ${expectStage} results but found none populated.`);
  }

  return {
    ok: !stale && !emptyDuringLive,
    phase,
    live,
    dataVersion: versionStr,
    ageHours: ageHours == null ? null : Number(ageHours.toFixed(2)),
    stale,
    emptyDuringLive,
    counts,
    reasons,
    checkedAt: new Date(nowMs).toISOString(),
  };
}
