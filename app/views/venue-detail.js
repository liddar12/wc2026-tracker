/* venue-detail.js — single venue header + list of matches there. */
import { flagFor } from '../components/team-flag.js';

export function renderVenueDetail(root, data, params) {
  const venues = Array.isArray(data.venues) ? data.venues : [];
  const schedule = Array.isArray(data.scheduleFull) ? data.scheduleFull : [];
  const id = params.id;
  const venue = venues.find((v) => v.id === id);
  if (!venue) {
    root.innerHTML = '<p class="loading">Venue not found.</p>';
    return;
  }

  const header = document.createElement('div');
  header.className = 'venue-detail-header';
  header.innerHTML = `
    <h2 style="margin:0;font-size:20px;">${escapeHtml(venue.name)}</h2>
    <div class="muted" style="font-size:13px;">
      ${escapeHtml(venue.city)}, ${escapeHtml(venue.state || '')} · ${escapeHtml(venue.country)}
      · Cap ${formatCap(venue.capacity)}
      · ${escapeHtml(venue.surface || 'Grass')}
      ${typeof venue.elevation_m === 'number' ? ` · ${venue.elevation_m} m elev.` : ''}
    </div>
    <div class="muted" style="font-size:12px;margin-top:2px;">Local TZ: ${escapeHtml(venue.timezone || '?')}</div>
  `;
  root.appendChild(header);

  const matches = schedule.filter((r) => r.venue_id === venue.id)
    .sort((a, b) => String(a.kickoff_utc).localeCompare(String(b.kickoff_utc)));

  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = `<h2>Matches here (${matches.length})</h2>`;
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No matches scheduled at this venue.';
    sec.appendChild(empty);
    root.appendChild(sec);
    return;
  }
  const list = document.createElement('div');
  list.className = 'schedule-list';
  for (const m of matches) {
    list.appendChild(renderRow(m));
  }
  sec.appendChild(list);
  root.appendChild(sec);
}

function renderRow(match) {
  const card = document.createElement('a');
  card.className = 'schedule-card';
  const isGroup = match.stage === 'group' && match.team_a && match.team_b;
  if (isGroup) {
    card.href = `#/matchup/team_a/${encodeURIComponent(match.team_a)}/team_b/${encodeURIComponent(match.team_b)}`;
  } else {
    card.href = '#/schedule';
    card.classList.add('is-tba');
  }

  let timeStr = '?', dateStr = '';
  try {
    const d = new Date(match.kickoff_utc);
    timeStr = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(d);
    dateStr = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
  } catch { /* noop */ }

  const a = match.team_a || 'TBA';
  const b = match.team_b || 'TBA';
  card.innerHTML = `
    <div class="sched-time">
      <div class="time">${escapeHtml(timeStr)}</div>
      <div class="muted tz">${escapeHtml(dateStr)}</div>
    </div>
    <div class="sched-teams">
      <div class="line"><span class="flag" aria-hidden="true">${flagFor(a)}</span>${escapeHtml(a)}</div>
      <div class="line"><span class="flag" aria-hidden="true">${flagFor(b)}</span>${escapeHtml(b)}</div>
    </div>
    <div class="sched-meta">
      <div class="stage">${escapeHtml(match.stage === 'group' ? `Group ${match.group || '?'}` : (match.stage || ''))}</div>
    </div>
  `;
  return card;
}

function formatCap(n) {
  if (typeof n !== 'number') return '?';
  return n.toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
