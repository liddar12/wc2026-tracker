/* matchup-card.js — anchored card linking to matchup-detail. */
import { flagFor } from './team-flag.js';
import { hasHighSeverity } from './upset-badge.js';
import { sparklineSvg } from './sparkline.js';
import { divergenceLine } from './model-market-divergence.js';
import { watchlistStar } from './watchlist-star.js';
import { sparklineForMatch, recordModelConfidence } from '../markets.js';
import { getFavoriteTeam } from '../favorites.js';

export function matchupCard(match, data) {
  recordModelConfidence(match);
  const markets = data?.markets;
  const fav = getFavoriteTeam();
  const isFav = !!fav && (match.team_a === fav || match.team_b === fav);

  const a = document.createElement('a');
  a.className = 'matchup-card' + (isFav ? ' is-fav-card' : '');
  a.href = `#/matchup/team_a/${encodeURIComponent(match.team_a)}/team_b/${encodeURIComponent(match.team_b)}`;

  const predLabel = predictionLabel(match);
  const predClass = predictionClass(match);

  const vs = document.createElement('div');
  vs.className = 'vs';
  vs.innerHTML = `
    <span class="pred ${predClass}">${escapeHtml(predLabel)}</span>
    <span>${match.win_confidence_pct.toFixed(0)}%${hasHighSeverity(match.upset_risk?.indicators) ? ' <span class="upset-dot" title="Upset risk"></span>' : ''}</span>
  `;
  const div = divergenceLine(markets, match);
  if (div) vs.appendChild(div);
  vs.appendChild(sparklineSvg(sparklineForMatch(markets, match), { width: 30, height: 8 }));

  const starWrap = document.createElement('div');
  starWrap.className = 'card-star';
  starWrap.appendChild(watchlistStar(match));

  a.innerHTML = `
    <div class="side">
      <span class="flag" aria-hidden="true">${flagFor(match.team_a)}</span>
      <span class="name">${escapeHtml(match.team_a)}</span>
    </div>
  `;
  a.appendChild(vs);
  a.innerHTML += `
    <div class="side right">
      <span class="name">${escapeHtml(match.team_b)}</span>
      <span class="flag" aria-hidden="true">${flagFor(match.team_b)}</span>
    </div>
  `;
  // Re-append vs since innerHTML+= wiped structure — rebuild properly
  a.innerHTML = `
    <div class="side">
      <span class="flag" aria-hidden="true">${flagFor(match.team_a)}</span>
      <span class="name">${escapeHtml(match.team_a)}</span>
    </div>
    <div class="vs-slot"></div>
    <div class="side right">
      <span class="name">${escapeHtml(match.team_b)}</span>
      <span class="flag" aria-hidden="true">${flagFor(match.team_b)}</span>
    </div>
  `;
  a.querySelector('.vs-slot').replaceWith(vs);
  a.appendChild(starWrap);

  return a;
}

function predictionLabel(match) {
  if (match.predicted_winner === 'draw_likely') return 'DRAW';
  if (match.predicted_winner === match.team_a) return match.team_a.toUpperCase().slice(0, 3);
  if (match.predicted_winner === match.team_b) return match.team_b.toUpperCase().slice(0, 3);
  return '—';
}

function predictionClass(match) {
  if (match.predicted_winner === 'draw_likely') return 'draw';
  if (match.predicted_winner === match.team_a) return 'win-a';
  if (match.predicted_winner === match.team_b) return 'win-b';
  return '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
