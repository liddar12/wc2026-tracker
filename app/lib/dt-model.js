/* dt-model.js — R16: the DT Model (player-talent + coaching, Elo-anchored,
   Monte-Carlo title odds). The site reads the prebuilt data/dt_model.json
   (the "site contract" from the DT pipeline) and exposes per-team lookups
   keyed by the app's team names.

   The DT JSON uses some country names that differ from the app's team keys
   (data/teams.json); DT_NAME_MAP bridges them. */

export const DT_NAME_MAP = {
  Turkey: 'Turkiye',
  'South Korea': 'Korea Republic',
  'Czech Republic': 'Czechia',
  'United States': 'USA',
  'Ivory Coast': "Cote d'Ivoire",
  'Cape Verde': 'Cabo Verde',
  'Curaçao': 'Curacao',
};

export function dtAppTeamName(country) {
  return DT_NAME_MAP[country] || country;
}

/**
 * Build a map: app-team-name → { rating, title_prob, rank, components }.
 * Memoized on the data object so repeated calls are cheap.
 */
export function dtRatingsByTeam(data) {
  if (!data) return {};
  if (data.__dtRatingsByTeam) return data.__dtRatingsByTeam;
  const rows = data?.dtModel?.team_rankings || [];
  const map = {};
  for (const r of rows) {
    if (!r?.country) continue;
    map[dtAppTeamName(r.country)] = {
      rating: typeof r.rating === 'number' ? r.rating : 0,
      title_prob: typeof r.title_prob === 'number' ? r.title_prob : 0,
      rank: r.rank || null,
      components: r.components || null,
    };
  }
  try { Object.defineProperty(data, '__dtRatingsByTeam', { value: map, enumerable: false }); }
  catch { /* frozen data — fine, just recompute */ }
  return map;
}

/** DT rating (0-100) for one team, or 0 if the team isn't in the model. */
export function dtRating(data, team) {
  return dtRatingsByTeam(data)[team]?.rating || 0;
}

/** Higher DT rating wins; ties → team_a (stable, matches the other sources). */
export function dtWinner(data, a, b) {
  const ra = dtRating(data, a);
  const rb = dtRating(data, b);
  if (ra === rb) return a;
  return ra >= rb ? a : b;
}

export function dtModelMeta(data) {
  return data?.dtModel?.model || null;
}
