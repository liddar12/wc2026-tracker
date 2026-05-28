/* market-bar.js — Kalshi tri-segment bar for matchup detail. */
import { getMatchOutcome } from '../markets.js';
import { tipButton } from './tooltip.js';

export function marketBar(match, markets) {
  const outcome = getMatchOutcome(markets, match);
  if (!outcome) return document.createDocumentFragment();

  const wrap = document.createElement('div');
  wrap.className = 'confidence-bar market-bar';

  const title = document.createElement('div');
  title.className = 'bar-title';
  title.append(document.createTextNode('Market (Kalshi) '));
  title.appendChild(tipButton('market', 'Market (Kalshi)'));
  wrap.appendChild(title);

  const a = outcome.team_a_prob ?? 0;
  const d = outcome.draw_prob ?? 0;
  const b = outcome.team_b_prob ?? 0;

  const bars = document.createElement('div');
  bars.className = 'bars';
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label',
    `Market ${match.team_a} ${a} percent, draw ${d} percent, ${match.team_b} ${b} percent`);

  const segA = document.createElement('div');
  segA.className = 'seg-a market-seg';
  segA.style.width = `${a}%`;
  const segD = document.createElement('div');
  segD.className = 'seg-d market-seg';
  segD.style.width = `${d}%`;
  const segB = document.createElement('div');
  segB.className = 'seg-b market-seg';
  segB.style.width = `${b}%`;
  bars.append(segA, segD, segB);

  const labels = document.createElement('div');
  labels.className = 'labels';
  labels.innerHTML = `
    <span><strong>${Number(a).toFixed(1)}%</strong> ${escapeHtml(match.team_a)}</span>
    <span><strong>${Number(d).toFixed(1)}%</strong> draw</span>
    <span>${escapeHtml(match.team_b)} <strong>${Number(b).toFixed(1)}%</strong></span>
  `;

  wrap.append(bars, labels);
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
