/* match-insights.js — RJ30.2 Match Intelligence. FREE ($0), deterministic,
   pure insight generation from an ESPN match_stats row (+ optional model xG and
   predicted winner). No AI, no network — a handful of rule-based reads that the
   matchup page shows as plain-language lines. The AI-narrated analysis (dormant
   until ANTHROPIC_API_KEY) is separate; this is the always-on free layer.

   Row shape (data/match_stats.json): { team_a, team_b, stats:{ a:{...}, b:{...} },
   key_events:[{minute,type,team}] }. stats keys mirror ESPN boxscore labels
   (possessionPct, totalShots, shotsOnTarget, passPct, ...). */

const round = (n) => Math.round(Number(n));

/**
 * Goals per side from key_events; OWN-goals credit the opponent.
 * @returns {{a:number,b:number}|null} null when there are no goal events at all.
 */
export function goalsFromEvents(row) {
  const ev = row?.key_events;
  if (!Array.isArray(ev) || ev.length === 0) return null;
  const a = row?.team_a, b = row?.team_b;
  let ga = 0, gb = 0, sawGoal = false;
  for (const e of ev) {
    const t = e?.type;
    if (t !== 'goal' && t !== 'pen-goal' && t !== 'own-goal') continue;
    sawGoal = true;
    const scorer = e?.team;
    let side;
    if (t === 'own-goal') side = scorer === a ? 'b' : 'a'; // into own net → opponent
    else side = scorer === a ? 'a' : scorer === b ? 'b' : null;
    if (side === 'a') ga++; else if (side === 'b') gb++;
  }
  return sawGoal ? { a: ga, b: gb } : null;
}

/**
 * 0–3 deterministic plain-text insight lines for a match, ordered by salience
 * (possession → clinical finishing → model agreement → xG read) and capped at 3.
 * Safe (returns []) on missing/partial stats.
 * @param {object} row      match_stats row
 * @param {object} [xgRow]  data/xg.json row { team_a_xg, team_b_xg }
 * @param {object} [modelRow] group/knockout_matchups row (predicted_winner | upset_risk.favored)
 * @returns {string[]}
 */
export function insightsFor(row, xgRow = null, modelRow = null) {
  const stats = row?.stats;
  if (!row || !stats || !stats.a || !stats.b) return [];
  const a = row.team_a, b = row.team_b;
  const sa = stats.a, sb = stats.b;
  const out = [];

  // 1) Possession dominance (>=58%). Tolerant of the short key the data-loader
  //    emits for the flat component shape (possessionPct → possession).
  const pa = Number(sa.possessionPct ?? sa.possession), pb = Number(sb.possessionPct ?? sb.possession);
  let possLine = null;
  if (Number.isFinite(pa) && pa >= 58) possLine = `${a} dominating possession (${round(pa)}%)`;
  else if (Number.isFinite(pb) && pb >= 58) possLine = `${b} dominating possession (${round(pb)}%)`;

  // 2) Clinical finishing — >=2 goals, efficient vs shots on target, out-scoring.
  const goals = goalsFromEvents(row);
  let clinicalLine = null;
  if (goals) {
    const clinical = (side, name, other) => {
      const g = goals[side];
      const sot = Number(stats[side]?.shotsOnTarget);
      if (g >= 2 && Number.isFinite(sot) && sot > 0 && g >= sot - 2 && g > goals[other]) {
        return `${name} clinical in front of goal (${g} from ${sot} on target)`;
      }
      return null;
    };
    clinicalLine = clinical('a', a, 'b') || clinical('b', b, 'a');
  }

  // 3) Model agreement — does the favored side actually run the game?
  const favored = modelRow?.predicted_winner || modelRow?.upset_risk?.favored || null;
  let modelLine = null;
  if (favored === a || favored === b) {
    const shotsA = Number(sa.totalShots) || 0, shotsB = Number(sb.totalShots) || 0;
    const runner = (pa > pb || shotsA > shotsB) ? a : (pb > pa || shotsB > shotsA) ? b : null;
    if (runner === favored) modelLine = `Model favored ${favored} — the play backs it up`;
    else if (runner) modelLine = `Model favored ${favored} — but ${runner} is running the game`;
  }

  // 4) xG read — out-shooting the lower model-xG side by a clear margin.
  let xgLine = null;
  if (xgRow) {
    const xa = Number(xgRow.team_a_xg), xb = Number(xgRow.team_b_xg);
    const shotsA = Number(sa.totalShots) || 0, shotsB = Number(sb.totalShots) || 0;
    if (shotsA - shotsB >= 4 && Number.isFinite(xa) && Number.isFinite(xb) && xa < xb) {
      xgLine = `${a} out-shooting the lower-xG side (${shotsA} vs ${shotsB})`;
    } else if (shotsB - shotsA >= 4 && Number.isFinite(xa) && Number.isFinite(xb) && xb < xa) {
      xgLine = `${b} out-shooting the lower-xG side (${shotsB} vs ${shotsA})`;
    }
  }

  for (const line of [possLine, clinicalLine, modelLine, xgLine]) {
    if (line && out.length < 3) out.push(line);
  }
  return out;
}

/**
 * Component-facing adapter. `app/components/match-stats.js` resolves a match to a
 * flat, correctly-oriented row ({ team_a, team_b, stats_a, stats_b, key_events })
 * and passes render options ({ xg, model }). Bridge that to insightsFor's nested
 * shape + positional args so the free insight lines actually render.
 * @param {object} row  { team_a, team_b, stats_a, stats_b, key_events } (or nested `stats`)
 * @param {object} [opts] { xg?, model? }
 * @returns {string[]}
 */
export function matchInsights(row, opts = {}) {
  if (!row || typeof row !== 'object') return [];
  const a = row.stats_a || (row.stats && row.stats.a) || {};
  const b = row.stats_b || (row.stats && row.stats.b) || {};
  const adapted = { team_a: row.team_a, team_b: row.team_b, stats: { a, b }, key_events: row.key_events };
  return insightsFor(adapted, opts.xg || opts.xgRow || null, opts.model || opts.modelRow || null);
}
