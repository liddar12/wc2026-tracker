/* schedule-view.js — browse the tournament by date.
 *
 * Route:    #/schedule[/date/YYYY-MM-DD]
 * Default:  today, if a match is today; otherwise the day with the next
 *           upcoming match; otherwise opening day.
 *
 * Layout:   horizontal scrollable day-picker strip + list of matches on the
 *           selected day with venue + local-time kickoff + broadcast tag.
 */
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';

export function renderScheduleView(root, data, params) {
  const schedule = Array.isArray(data.scheduleFull) ? data.scheduleFull : [];
  const venues = Array.isArray(data.venues) ? data.venues : [];
  const venueById = new Map(venues.map((v) => [v.id, v]));

  if (!schedule.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Full tournament schedule is not yet published.';
    root.appendChild(empty);
    return;
  }

  // Group by date in the user's local timezone so a 9pm Wed kickoff doesn't
  // get hidden under Thursday's pill when UTC happens to roll the calendar.
  const byDate = new Map();
  for (const row of schedule) {
    if (!row?.kickoff_utc) continue;
    const localDate = toLocalDateISO(row.kickoff_utc);
    if (!localDate) continue;
    if (!byDate.has(localDate)) byDate.set(localDate, []);
    byDate.get(localDate).push(row);
  }
  const dates = [...byDate.keys()].sort();

  const today = new Date();
  const todayISO = formatLocalDateISO(today);
  let active = params.date;
  if (!active || !byDate.has(active)) {
    active = byDate.has(todayISO)
      ? todayISO
      : (dates.find((d) => d >= todayISO) || dates[0]);
  }

  // Day picker strip
  const picker = document.createElement('div');
  picker.className = 'day-picker scroll-area';
  picker.setAttribute('role', 'tablist');
  picker.setAttribute('aria-label', 'Match days');
  for (const d of dates) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'tab';
    btn.className = 'day-pill' + (d === active ? ' is-active' : '');
    btn.dataset.date = d;
    const [y, m, day] = d.split('-').map(Number);
    const dateObj = new Date(y, m - 1, day);
    const dow = dateObj.toLocaleDateString(undefined, { weekday: 'short' });
    const md = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    btn.innerHTML = `<span class="dow">${escapeHtml(dow)}</span><span class="md">${escapeHtml(md)}</span><span class="cnt">${byDate.get(d).length}</span>`;
    btn.addEventListener('click', () => setRoute('schedule', { date: d }));
    picker.appendChild(btn);
  }
  root.appendChild(picker);

  // Center the active pill if possible.
  requestAnimationFrame(() => {
    const el = picker.querySelector('.day-pill.is-active');
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }
  });

  // Heading — render the local-date as a friendly long string.
  const [ay, am, ad] = active.split('-').map(Number);
  const headingDate = new Date(ay, am - 1, ad).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  const heading = document.createElement('h2');
  heading.className = 'section-heading';
  heading.textContent = headingDate;
  heading.style.cssText = 'margin: 12px 0 8px; font-size: 16px;';
  root.appendChild(heading);

  // Match list
  const list = document.createElement('div');
  list.className = 'schedule-list';
  const matches = (byDate.get(active) || []).slice().sort((a, b) =>
    String(a.kickoff_utc).localeCompare(String(b.kickoff_utc))
  );

  for (const m of matches) {
    list.appendChild(scheduleCard(m, venueById));
  }
  root.appendChild(list);
}

function scheduleCard(match, venueById) {
  const card = document.createElement('a');
  card.className = 'schedule-card';
  const isGroup = match.stage === 'group' && match.team_a && match.team_b;
  if (isGroup) {
    card.href = `#/matchup/team_a/${encodeURIComponent(match.team_a)}/team_b/${encodeURIComponent(match.team_b)}`;
  } else {
    card.href = '#/schedule';
    card.classList.add('is-tba');
  }

  const venue = venueById.get(match.venue_id);
  const kickoff = formatKickoffLocal(match.kickoff_utc, venue?.timezone);
  const broadcast = match.broadcast?.us || {};
  const channelLabel = broadcast.english_channel || broadcast.spanish_channel || 'Channel TBA';
  const stageLabel = match.stage === 'group'
    ? `Group ${match.group || '?'}`
    : prettyStage(match.stage);

  const aTeam = match.team_a || 'TBA';
  const bTeam = match.team_b || 'TBA';
  card.innerHTML = `
    <div class="sched-time">
      <div class="time">${escapeHtml(kickoff.time)}</div>
      <div class="muted tz">${escapeHtml(kickoff.tz)}</div>
    </div>
    <div class="sched-teams">
      <div class="line"><span class="flag" aria-hidden="true">${flagFor(aTeam)}</span>${escapeHtml(aTeam)}</div>
      <div class="line"><span class="flag" aria-hidden="true">${flagFor(bTeam)}</span>${escapeHtml(bTeam)}</div>
    </div>
    <div class="sched-meta">
      <div class="stage">${escapeHtml(stageLabel)}</div>
      <div class="muted venue">${escapeHtml(venue?.city || 'Venue TBA')}</div>
      <div class="muted channel">${escapeHtml(channelLabel)}</div>
    </div>
  `;
  return card;
}

function prettyStage(s) {
  switch (s) {
    case 'r32': return 'Round of 32';
    case 'r16': return 'Round of 16';
    case 'qf': return 'Quarterfinal';
    case 'sf': return 'Semifinal';
    case 'third_place': return 'Third place';
    case 'final': return 'Final';
    default: return s || '';
  }
}

function formatKickoffLocal(iso, _tz) {
  // Render in the user's browser timezone, regardless of venue tz. The QA
  // spec mandates `Intl.DateTimeFormat(undefined, { timeStyle: 'short' })`.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { time: '?', tz: '' };
    const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(d);
    const tz = (Intl.DateTimeFormat(undefined).resolvedOptions().timeZone || '').split('/').pop();
    return { time, tz: tz || '' };
  } catch {
    return { time: '?', tz: '' };
  }
}

function toLocalDateISO(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return formatLocalDateISO(d);
  } catch { return null; }
}
function formatLocalDateISO(d) {
  // YYYY-MM-DD in local time (not UTC).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
