/* push-diff-core.mjs — RJ30-3 (RJ30-B). The PURE, dependency-free goal/kickoff
   diff core for the push sender. No network, no Supabase, no crypto — just
   in-memory transforms over the committed data shapes, so it can be unit-tested
   (tests/feature/push-diff.test.mjs) without any I/O. Mirrors the
   results-health-core.mjs split: the Netlify function does the I/O, this does
   the logic.

   Data shapes (committed JSON, read off the deployed site by the function):
   - events  : { "<A__vs__B>": { events:[{minute,type,player,team}], updated_at },
                 "__meta__": {...} }   (data/match_events.json)
   - results : { <tier>: { "<A__vs__B>": {score_a,score_b,status,kickoff_utc,minute?} },
                 last_updated }        (data/actual_results.json)
   - schedule: [ { match_id, stage, team_a, team_b, kickoff_utc, ... } ]
                                       (data/schedule_full.json)
   - stateRows: [ { match_id, kind:'goal'|'kickoff', seq } ]  (push_notify_state)
*/

// FINAL/LIVE status sets — kept identical to app/lib/match-status.js so the
// status gate here agrees with the rest of the app. (Inlined rather than
// imported because Netlify functions bundle from netlify/functions; importing
// ../../app/* works under esbuild but the pure core stays self-contained for
// the node:test runner.)
export const FINAL_STATUSES = new Set([
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_OF_FULL_TIME',
  'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
]);
export const LIVE_STATUSES = new Set([
  'STATUS_IN_PROGRESS', 'STATUS_FIRST_HALF', 'STATUS_SECOND_HALF',
  'STATUS_HALFTIME', 'STATUS_END_PERIOD', 'STATUS_OVERTIME',
  'STATUS_FIRST_HALF_EXTRA_TIME', 'STATUS_SECOND_HALF_EXTRA_TIME',
  'STATUS_HALFTIME_ET', 'STATUS_SHOOTOUT',
]);

// Maps a schedule row's `stage` to the actual_results tier key (mirror of
// live-scores.js TIER_BY_STAGE).
export const TIER_BY_STAGE = {
  group: 'group_stage', group_stage: 'group_stage',
  round_of_32: 'round_of_32', round_of_16: 'round_of_16',
  quarterfinals: 'quarterfinals', semifinals: 'semifinals',
  third_place: 'third_place', final: 'final',
};

// Do not blast every historic goal at once if the sender first observes an
// already-finished match (e.g. it was dormant during the game). A FINAL match
// older than this guard with no prior state is skipped. 3h matches the knockout
// live window in match-status.js.
export const GOAL_BACKFILL_GUARD_MS = 3 * 60 * 60 * 1000;

/** Look up an actual_results record for a schedule row, trying both
 *  A__vs__B and B__vs__A keys across the row's tier (and falling back to a
 *  scan of all tiers, like the client's key logic). Returns the record or null. */
function findResultRecord(results, row) {
  if (!results || typeof results !== 'object') return null;
  const a = row.team_a, b = row.team_b;
  const fwd = `${a}__vs__${b}`;
  const rev = `${b}__vs__${a}`;
  const tierKey = TIER_BY_STAGE[row.stage] || 'group_stage';
  const tier = results[tierKey];
  if (tier && typeof tier === 'object') {
    if (tier[fwd]) return tier[fwd];
    if (tier[rev]) return tier[rev];
  }
  // Fallback: scan every tier (the match may be filed under a different stage).
  for (const [k, v] of Object.entries(results)) {
    if (k === 'last_updated' || !v || typeof v !== 'object') continue;
    if (v[fwd]) return v[fwd];
    if (v[rev]) return v[rev];
  }
  return null;
}

/** Find the schedule row for a given match_id (events are keyed by match_id). */
function scheduleRowFor(schedule, matchId) {
  if (!Array.isArray(schedule)) return null;
  return schedule.find((r) => r && r.match_id === matchId) || null;
}

/** Index state rows by `${match_id}|${kind}` for O(1) lookup. */
function indexState(stateRows) {
  const idx = new Map();
  for (const s of stateRows || []) {
    if (!s || !s.match_id || !s.kind) continue;
    idx.set(`${s.match_id}|${s.kind}`, s);
  }
  return idx;
}

/**
 * Diff goal events against the already-sent state.
 *
 * For each match in `events`, count `type === 'goal'` rows. If the match status
 * (from `results`) is LIVE, or it's a FINAL within the backfill guard, and the
 * goal count exceeds the previously-sent seq, emit a single collapsed notice
 * (latest scorer in the body) carrying nextSeq = current goal count.
 *
 * STATUS-GATED: a STATUS_SCHEDULED 0-0 stub (or a missing record) never emits,
 * so a stale schedule scrape can't fire a phantom goal alert.
 *
 * @returns {Array<{match_id,kind:'goal',teams:[string,string],player:string,
 *                   minute:string,score:string,nextSeq:number}>}
 */
export function diffGoals(events, results, schedule, stateRows, nowMs = Date.now()) {
  const out = [];
  if (!events || typeof events !== 'object') return out;
  const state = indexState(stateRows);

  for (const [matchId, entry] of Object.entries(events)) {
    if (matchId === '__meta__' || !entry || typeof entry !== 'object') continue;
    const goalEvents = Array.isArray(entry.events)
      ? entry.events.filter((e) => e && e.type === 'goal')
      : [];
    const goalCount = goalEvents.length;
    if (goalCount === 0) continue;

    const row = scheduleRowFor(schedule, matchId);
    if (!row) continue; // unknown fixture — can't target teams safely

    const rec = findResultRecord(results, row);
    const status = rec?.status || '';
    const isLive = LIVE_STATUSES.has(status);
    const isFinal = FINAL_STATUSES.has(status);

    // STATUS gate: only LIVE matches, or a FINAL that just completed, notify.
    // STATUS_SCHEDULED / missing / pending never fire a goal alert.
    if (!isLive && !isFinal) continue;

    const prev = state.get(`${matchId}|goal`);
    const prevSeq = prev ? Number(prev.seq) || 0 : 0;
    const hasPriorState = !!prev;

    // Backfill guard: a FINAL match observed for the first time long after
    // kickoff would otherwise blast every goal. Skip unless it's currently LIVE
    // or we already have a state row (mid-game, legitimately catching up).
    if (isFinal && !hasPriorState) {
      const ko = Date.parse(rec?.kickoff_utc || row.kickoff_utc || '');
      if (Number.isFinite(ko) && nowMs - ko > GOAL_BACKFILL_GUARD_MS) continue;
    }

    if (goalCount <= prevSeq) continue; // nothing new — de-dup

    const latest = goalEvents[goalEvents.length - 1] || {};
    const sa = rec?.score_a, sb = rec?.score_b;
    const score = (Number.isFinite(sa) && Number.isFinite(sb)) ? `${sa}-${sb}` : '';
    out.push({
      match_id: matchId,
      kind: 'goal',
      teams: [row.team_a, row.team_b],
      player: latest.player || '',
      minute: latest.minute || '',
      score,
      nextSeq: goalCount,
    });
  }
  return out;
}

/**
 * Find kickoffs within [now, now + leadMin] that haven't been announced and
 * aren't already LIVE/FINAL.
 *
 * @returns {Array<{match_id,kind:'kickoff',teams:[string,string],kickoff_utc:string}>}
 */
export function imminentKickoffs(schedule, results, stateRows, nowMs = Date.now(), leadMin = 15) {
  const out = [];
  if (!Array.isArray(schedule)) return out;
  const state = indexState(stateRows);
  const windowEnd = nowMs + leadMin * 60000;

  for (const row of schedule) {
    if (!row || !row.match_id || !row.team_a || !row.team_b) continue;
    const k = Date.parse(row.kickoff_utc || '');
    if (!Number.isFinite(k)) continue;
    if (k < nowMs || k > windowEnd) continue; // outside the imminent window

    // Already announced?
    if (state.has(`${row.match_id}|kickoff`)) continue;

    // Already kicked off (LIVE) or done (FINAL)? Don't pre-announce.
    const rec = findResultRecord(results, row);
    const status = rec?.status || '';
    if (LIVE_STATUSES.has(status) || FINAL_STATUSES.has(status)) continue;

    out.push({
      match_id: row.match_id,
      kind: 'kickoff',
      teams: [row.team_a, row.team_b],
      kickoff_utc: row.kickoff_utc,
    });
  }
  return out;
}

/** The two canonical team names a notice targets (subscriber teams match these). */
export function targetTeamsForNotice(notice) {
  return Array.isArray(notice?.teams) ? notice.teams.slice(0, 2) : [];
}
