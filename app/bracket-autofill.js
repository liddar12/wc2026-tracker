/* bracket-autofill.js — A3 + F2: build a complete 31-pick bracket from one
   of multiple sources: Model (composite gap), Kalshi (tournament-winner
   prob), Hybrid 50-50, or Public consensus (most-picked across pools).

   Returns an array shaped like the my-brackets persisted-bracket entries,
   ready to drop into localStorage:
     [{ matchNumber, team, team_a, team_b }, ...]
*/

import {
  STAGE_ORDER, resolveSlots, isSlotPlaceholder,
  computeProjectedGroupOrder, computeGroupStandings,
} from './bracket-resolver.js';
import { dtWinner } from './lib/dt-model.js';

export const FILL_SOURCES = {
  model:     { label: 'Model',     description: 'My composite power ranking (mine + elo + tmv + qual)' },
  dt:        { label: 'DT',        description: 'DT Model rating (player-talent + coaching, Elo-anchored)' },
  kalshi:    { label: 'Markets',    description: 'Market tournament-winner probability per team' },
  hybrid:    { label: '⅓·⅓·⅓',     description: 'Equal blend of J5L + DT + Markets (forecast hybrid strength)' },
  consensus: { label: 'Consensus', description: 'Most-picked team across all public pools' },
};

export function buildAutofill(data, source, opts = {}) {
  const sf = data?.scheduleFull || [];
  const ko = sf.filter((m) => STAGE_ORDER.includes(m.stage))
    .sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
  const winnerOf = makeWinnerFn(data, source, opts.consensusMap || null);
  // What-if overrides ({matchNumber: team}) take precedence over the model for
  // UNPLAYED matches; actual results still win (handled inside resolveSlots).
  const overrides = opts.overrides || {};
  resolveSlots(ko, data, {
    winnerResolver: ({ matchNumber, team_a, team_b }) => {
      const ov = overrides[matchNumber];
      if (ov && (ov === team_a || ov === team_b)) return ov;
      return winnerOf(team_a, team_b);
    },
  });
  const out = [];
  for (const m of ko) {
    const a = m.resolved_team_a;
    const b = m.resolved_team_b;
    if (!a || !b || isSlotPlaceholder(a) || isSlotPlaceholder(b)) continue;
    const team = m.projected_winner;
    if (!team) continue;
    out.push({ matchNumber: m.match_number, team, team_a: a, team_b: b });
  }
  return out;
}

function makeWinnerFn(data, source, consensusMap) {
  const teams = data?.teams || {};
  const kalshiRows = data?.markets?.tournament_winner || [];
  const kalshiByTeam = {};
  for (const r of kalshiRows) {
    if (r?.team && typeof r.prob_pct === 'number') kalshiByTeam[r.team] = r.prob_pct;
  }
  switch (source) {
    case 'dt':
      return (a, b) => dtWinner(data, a, b);
    case 'kalshi':
      return (a, b) => {
        const pa = kalshiByTeam[a] || 0;
        const pb = kalshiByTeam[b] || 0;
        if (pa === pb) return a;
        return pa >= pb ? a : b;
      };
    case 'hybrid': {
      // Prefer the precomputed ⅓ J5L + ⅓ DT + ⅓ Kalshi strength (forecast.json,
      // recomputed each data refresh). Fall back to composite+Kalshi if absent.
      const hs = {};
      for (const r of (data?.forecast?.teams || [])) {
        if (r?.team && typeof r.hybrid_strength === 'number') hs[r.team] = r.hybrid_strength;
      }
      return (a, b) => {
        if (a in hs || b in hs) {
          const sa = hs[a] ?? -Infinity;
          const sb = hs[b] ?? -Infinity;
          return sa >= sb ? a : b;
        }
        const sa = 0.5 * (teams[a]?.composite || 0) + 0.5 * (kalshiByTeam[a] || 0);
        const sb = 0.5 * (teams[b]?.composite || 0) + 0.5 * (kalshiByTeam[b] || 0);
        return sa >= sb ? a : b;
      };
    }
    case 'consensus':
      return (a, b) => {
        if (!consensusMap) return modelWinner(teams, a, b);
        const cnt = (t) => consensusMap[t] || 0;
        if (cnt(a) === cnt(b)) return modelWinner(teams, a, b);
        return cnt(a) > cnt(b) ? a : b;
      };
    case 'model':
    default:
      return (a, b) => modelWinner(teams, a, b);
  }
}

function modelWinner(teams, a, b) {
  const ca = teams[a]?.composite || 0;
  const cb = teams[b]?.composite || 0;
  if (ca === cb) return a;
  return ca >= cb ? a : b;
}

// Merge autofill into an existing bracket: fills empty slots only by default,
// or overwrites everything when `overwriteExisting` is true.
export function mergeAutofillIntoBracket(autofill, currentPicks, overwriteExisting = false) {
  const next = currentPicks ? JSON.parse(JSON.stringify(currentPicks)) : {};
  for (const row of autofill) {
    const key = String(row.matchNumber);
    if (next[key] && !overwriteExisting) continue;
    next[key] = { team: row.team, team_a: row.team_a, team_b: row.team_b };
  }
  return next;
}
