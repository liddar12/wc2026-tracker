/* market-odds.js — Kalshi block for matchup detail (match bar or winner fallback). */
import { escapeHtml } from '../lib/escape.js';
import { getMatchOutcome, winnerByTeam, kalshiAttribution } from '../markets.js';
import { marketBar } from './market-bar.js';
import { divergenceLine } from './model-market-divergence.js';
import { flagFor } from './team-flag.js';
import { formatLastUpdated } from '../data-loader.js';

export function marketOddsSection(match, markets) {
  const wrap = document.createElement('div');
  wrap.className = 'market-odds-section';

  const outcome = getMatchOutcome(markets, match);

  if (outcome) {
    const div = divergenceLine(markets, match);
    if (div) wrap.appendChild(div);
    wrap.appendChild(marketBar(match, markets));
  } else {
    wrap.appendChild(winnerFallback(match, markets));
  }

  if (markets?.updated_at) {
    const updated = document.createElement('p');
    updated.className = 'market-updated muted';
    updated.textContent = `Updated ${formatLastUpdated(markets.updated_at)}`;
    wrap.appendChild(updated);
  }

  wrap.appendChild(kalshiAttribution());
  return wrap;
}

function winnerFallback(match, markets) {
  const wrap = document.createElement('div');
  wrap.className = 'winner-odds-fallback';

  const title = document.createElement('div');
  title.className = 'bar-title';
  title.textContent = 'Market';
  wrap.appendChild(title);

  const note = document.createElement('p');
  note.className = 'market-fallback-note muted';
  note.textContent = 'Per-match market prices not yet available — showing tournament winner odds';
  wrap.appendChild(note);

  const winners = winnerByTeam(markets);
  const cards = document.createElement('div');
  cards.className = 'winner-odds-cards';
  cards.appendChild(winnerCard(match.team_a, winners.get(match.team_a)));
  cards.appendChild(winnerCard(match.team_b, winners.get(match.team_b)));
  wrap.appendChild(cards);

  return wrap;
}

function winnerCard(team, row) {
  const card = document.createElement('div');
  card.className = 'winner-odds-card';

  const prob = row?.prob_pct;
  const delta = row?.delta_24h_pp;
  let deltaHtml = '';
  if (typeof delta === 'number' && delta !== 0) {
    const up = delta >= 0;
    deltaHtml = `<span class="winner-odds-delta ${up ? 'delta-up' : 'delta-down'}">${up ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)}</span>`;
  }

  card.innerHTML = `
    <span class="flag" aria-hidden="true">${flagFor(team)}</span>
    <span class="winner-odds-team">${escapeHtml(team)}</span>
    <span class="winner-odds-prob">${typeof prob === 'number' ? prob.toFixed(1) + '%' : '—'}</span>
    ${deltaHtml}
  `;
  return card;
}

