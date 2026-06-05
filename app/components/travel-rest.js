import { escapeHtml } from '../lib/escape.js';
/* travel-rest.js — days_since_last_match + km flown per team. */

export function travelRestSection(match, fatigue) {
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = '<h2>Travel + rest</h2>';

  const key1 = `${match.team_a}__vs__${match.team_b}`;
  const key2 = `${match.team_b}__vs__${match.team_a}`;
  const block = (fatigue || {})[key1] || (fatigue || {})[key2];

  if (!block) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Fatigue numbers will appear once both teams have a prior fixture.';
    sec.appendChild(p);
    return sec;
  }

  const grid = document.createElement('div');
  grid.className = 'fatigue-grid';
  grid.appendChild(col(match.team_a, block.team_a));
  grid.appendChild(col(match.team_b, block.team_b));
  sec.appendChild(grid);
  return sec;
}

function col(team, b) {
  const c = document.createElement('div');
  c.className = 'fatigue-col';
  if (!b) {
    c.innerHTML = `<div class="form-team">${escapeHtml(team)}</div><div class="muted">First match — no prior travel.</div>`;
    return c;
  }
  const days = (b.days_since_last_match == null)
    ? '—'
    : `${b.days_since_last_match.toFixed(1)} days`;
  const km = (b.km_flown_to_this_venue == null)
    ? '—'
    : `${b.km_flown_to_this_venue.toFixed(0)} km`;
  c.innerHTML = `
    <div class="form-team">${escapeHtml(team)}</div>
    <div class="sub-row"><span>Rest</span><strong>${escapeHtml(days)}</strong></div>
    <div class="sub-row"><span>Travel</span><strong>${escapeHtml(km)}</strong></div>
  `;
  return c;
}

