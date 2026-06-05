import { escapeHtml } from '../lib/escape.js';
/* scorers.js — top-3 scorers per team in the tournament. */

export function scorersSection(match, scorers) {
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = '<h2>Top scorers (tournament)</h2>';
  const wrap = document.createElement('div');
  wrap.className = 'scorers-grid';
  wrap.appendChild(side(match.team_a, (scorers || {})[match.team_a]));
  wrap.appendChild(side(match.team_b, (scorers || {})[match.team_b]));
  sec.appendChild(wrap);
  return sec;
}

function side(team, players) {
  const col = document.createElement('div');
  col.className = 'scorers-col';
  if (!Array.isArray(players) || !players.length) {
    col.innerHTML = `<div class="form-team">${escapeHtml(team)}</div><div class="muted">No tournament goals yet.</div>`;
    return col;
  }
  const rows = players.slice(0, 3).map((p) => `
    <div class="sub-row">
      <span>${escapeHtml(p.name)}${p.club ? ` <span class="muted">· ${escapeHtml(p.club)}</span>` : ''}</span>
      <strong>${p.goals}⚽</strong>
    </div>
  `).join('');
  col.innerHTML = `<div class="form-team">${escapeHtml(team)}</div>${rows}`;
  return col;
}

