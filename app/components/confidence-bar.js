/* confidence-bar.js — render a tri-segment probability bar for a match. */
import { tipButton } from './tooltip.js';

export function confidenceBar(match, { title = 'Model prediction', showTip = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'confidence-bar';

  if (title) {
    const heading = document.createElement('div');
    heading.className = 'bar-title';
    heading.append(document.createTextNode(title + ' '));
    if (showTip) heading.appendChild(tipButton('confidence', 'Confidence'));
    wrap.appendChild(heading);
  }

  const { team_a_wins, draw, team_b_wins } = match.probabilities;
  const bars = document.createElement('div');
  bars.className = 'bars';
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label',
    `${match.team_a} ${team_a_wins.toFixed(0)} percent, draw ${draw.toFixed(0)} percent, ${match.team_b} ${team_b_wins.toFixed(0)} percent`);

  const segA = document.createElement('div');
  segA.className = 'seg-a';
  segA.style.width = `${team_a_wins}%`;
  const segD = document.createElement('div');
  segD.className = 'seg-d';
  segD.style.width = `${draw}%`;
  const segB = document.createElement('div');
  segB.className = 'seg-b';
  segB.style.width = `${team_b_wins}%`;
  bars.append(segA, segD, segB);

  const labels = document.createElement('div');
  labels.className = 'labels';
  labels.innerHTML = `
    <span><strong>${team_a_wins.toFixed(1)}%</strong> ${escapeHtml(match.team_a)}</span>
    <span><strong>${draw.toFixed(1)}%</strong> draw</span>
    <span>${escapeHtml(match.team_b)} <strong>${team_b_wins.toFixed(1)}%</strong></span>
  `;

  wrap.append(bars, labels);
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
