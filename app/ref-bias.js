/* ref-bias.js — client-side referee bias computation.
 *
 * Two analyses, both surfaced with confidence flags:
 *
 *   teamHistory(refHistory, team, sport_means)
 *     For each (team_a, team_b) in the ref's past matches, the relevant
 *     "cards against this team" count is yellows_a + 2 * reds_a where the
 *     given team played as team_a (or the b side analogously). We compute:
 *       z_cards     = (avg_cards_against_team - mean_cards) / std_cards
 *       z_penalties = (avg_pens_against_team - mean_pens) / std_pens
 *     Confidence:
 *       n >= 5  -> high
 *       2..4    -> medium
 *       <= 1    -> low
 *
 *   confederationLean(refHistory, refConfed, teamConfedLookup)
 *     Compare avg cards + penalties given to teams from refConfed vs teams
 *     from other confederations across the ref's full history. We surface
 *     "tends to give X% fewer cards to UEFA teams" style strings.
 *
 * Inputs are plain JSON; no DOM. UI rendering happens in components/referee.js.
 */

const LEAGUE_CARDS_MEAN = 2.9;   // intentional simple priors (~3 yellows/match)
const LEAGUE_CARDS_STD = 1.4;
const LEAGUE_PENS_MEAN = 0.22;
const LEAGUE_PENS_STD = 0.18;

function ofIdx(idx, side) {
  return side === 'a' ? `_a` : `_b`;
}

export function cardsAgainstTeam(refHistory, team) {
  const out = [];
  for (const h of refHistory || []) {
    if (h.team_a === team) {
      out.push((h.yellows_a || 0) + 2 * (h.reds_a || 0));
    } else if (h.team_b === team) {
      out.push((h.yellows_b || 0) + 2 * (h.reds_b || 0));
    }
  }
  return out;
}

export function penaltiesAgainstTeam(refHistory, team) {
  const out = [];
  for (const h of refHistory || []) {
    if (h.team_a === team) out.push(h.penalties_a || 0);
    else if (h.team_b === team) out.push(h.penalties_b || 0);
  }
  return out;
}

export function teamHistory(refHistory, team) {
  const cards = cardsAgainstTeam(refHistory, team);
  const pens = penaltiesAgainstTeam(refHistory, team);
  const n = cards.length;
  let confidence = 'low';
  if (n >= 5) confidence = 'high';
  else if (n >= 2) confidence = 'medium';

  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const meanCards = avg(cards);
  const meanPens = avg(pens);
  const zCards = n ? (meanCards - LEAGUE_CARDS_MEAN) / LEAGUE_CARDS_STD : null;
  const zPens = n ? (meanPens - LEAGUE_PENS_MEAN) / LEAGUE_PENS_STD : null;
  return { team, n, mean_cards: meanCards, mean_pens: meanPens, z_cards: zCards, z_pens: zPens, confidence };
}

export function confederationLean(refHistory, refConfederation, teamConfedLookup) {
  if (!refConfederation || typeof teamConfedLookup !== 'function') {
    return null;
  }
  let ownN = 0, ownCards = 0, ownPens = 0;
  let otherN = 0, otherCards = 0, otherPens = 0;
  for (const h of refHistory || []) {
    for (const side of ['a', 'b']) {
      const t = h[`team_${side}`];
      if (!t) continue;
      const tConfed = teamConfedLookup(t);
      const cards = (h[`yellows_${side}`] || 0) + 2 * (h[`reds_${side}`] || 0);
      const pens = h[`penalties_${side}`] || 0;
      if (tConfed === refConfederation) {
        ownN += 1; ownCards += cards; ownPens += pens;
      } else if (tConfed) {
        otherN += 1; otherCards += cards; otherPens += pens;
      }
    }
  }
  if (!ownN || !otherN) return null;
  const ownAvgCards = ownCards / ownN;
  const otherAvgCards = otherCards / otherN;
  const ownAvgPens = ownPens / ownN;
  const otherAvgPens = otherPens / otherN;
  const cardsDeltaPct = otherAvgCards > 0 ? ((ownAvgCards - otherAvgCards) / otherAvgCards) * 100 : null;
  const pensDeltaPct = otherAvgPens > 0 ? ((ownAvgPens - otherAvgPens) / otherAvgPens) * 100 : null;
  const total = ownN + otherN;
  let confidence = 'low';
  if (total >= 30) confidence = 'high';
  else if (total >= 10) confidence = 'medium';
  return {
    own_confederation: refConfederation,
    own_n: ownN,
    other_n: otherN,
    cards_delta_pct: cardsDeltaPct,
    pens_delta_pct: pensDeltaPct,
    confidence
  };
}

export function buildTeamConfedLookup(teams) {
  // Lightweight country -> confederation guess. The teams.json doesn't carry
  // confederation, so we ship a static map. Unknown teams return null.
  const CONFED = {
    'USA': 'CONCACAF', 'Canada': 'CONCACAF', 'Mexico': 'CONCACAF', 'Costa Rica': 'CONCACAF',
    'Panama': 'CONCACAF', 'Honduras': 'CONCACAF', 'Jamaica': 'CONCACAF', 'Haiti': 'CONCACAF',
    'Argentina': 'CONMEBOL', 'Brazil': 'CONMEBOL', 'Uruguay': 'CONMEBOL', 'Colombia': 'CONMEBOL',
    'Chile': 'CONMEBOL', 'Peru': 'CONMEBOL', 'Ecuador': 'CONMEBOL', 'Paraguay': 'CONMEBOL',
    'Venezuela': 'CONMEBOL', 'Bolivia': 'CONMEBOL',
    'France': 'UEFA', 'Germany': 'UEFA', 'Spain': 'UEFA', 'Portugal': 'UEFA',
    'Netherlands': 'UEFA', 'England': 'UEFA', 'Italy': 'UEFA', 'Belgium': 'UEFA',
    'Croatia': 'UEFA', 'Switzerland': 'UEFA', 'Denmark': 'UEFA', 'Poland': 'UEFA',
    'Czechia': 'UEFA', 'Norway': 'UEFA', 'Sweden': 'UEFA', 'Türkiye': 'UEFA', 'Turkiye': 'UEFA',
    'Serbia': 'UEFA', 'Austria': 'UEFA', 'Hungary': 'UEFA', 'Scotland': 'UEFA', 'Wales': 'UEFA',
    'Republic of Ireland': 'UEFA', 'Ireland': 'UEFA', 'Ukraine': 'UEFA', 'Greece': 'UEFA',
    'Albania': 'UEFA', 'Romania': 'UEFA', 'Slovenia': 'UEFA', 'Slovakia': 'UEFA',
    'Bosnia and Herzegovina': 'UEFA',
    'Senegal': 'CAF', 'Morocco': 'CAF', 'Tunisia': 'CAF', 'Algeria': 'CAF', 'Egypt': 'CAF',
    'Nigeria': 'CAF', 'Ghana': 'CAF', "Côte d'Ivoire": 'CAF', 'Ivory Coast': 'CAF',
    'Cameroon': 'CAF', 'South Africa': 'CAF', 'Mali': 'CAF', 'Burkina Faso': 'CAF',
    'Cape Verde': 'CAF', 'Cabo Verde': 'CAF',
    'Japan': 'AFC', 'Korea Republic': 'AFC', 'South Korea': 'AFC', 'Australia': 'AFC',
    'Iran': 'AFC', 'IR Iran': 'AFC', 'Saudi Arabia': 'AFC', 'Qatar': 'AFC', 'UAE': 'AFC',
    'Uzbekistan': 'AFC', 'Jordan': 'AFC', 'Iraq': 'AFC',
    'New Zealand': 'OFC'
  };
  // If teams.json ever carries an explicit confed, prefer it.
  return (team) => {
    if (!team) return null;
    const t = (teams || {})[team];
    if (t?.confederation) return t.confederation;
    return CONFED[team] || null;
  };
}
