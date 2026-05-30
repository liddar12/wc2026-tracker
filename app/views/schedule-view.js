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
import { getFavoriteTeam } from '../favorites.js';

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

  const fav = getFavoriteTeam();
  const isFavMatch = (row) => !!fav && (row.team_a === fav || row.team_b === fav);
  // "My matches" filter — only meaningful when a favorite is set AND that team
  // actually appears in the (named) fixtures. Knockout slots are placeholders
  // (e.g. "W101"), so the favorite only matches its group-stage rows for now.
  const favDates = new Set();
  for (const row of schedule) {
    if (isFavMatch(row) && row?.kickoff_utc) {
      const d = toLocalDateISO(row.kickoff_utc);
      if (d) favDates.add(d);
    }
  }
  const mineAvailable = favDates.size > 0;
  const mineOnly = mineAvailable && params.mine === '1';

  // Group by date in the user's local timezone so a 9pm Wed kickoff doesn't
  // get hidden under Thursday's pill when UTC happens to roll the calendar.
  const byDate = new Map();
  for (const row of schedule) {
    if (!row?.kickoff_utc) continue;
    if (mineOnly && !isFavMatch(row)) continue;
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

  // "My matches" toolbar — only rendered when a favorite is set and plays.
  if (mineAvailable) {
    const toolbar = document.createElement('div');
    toolbar.className = 'sched-toolbar';
    toolbar.innerHTML = `
      <button type="button" class="watch-filter sched-mine ${mineOnly ? 'is-active' : ''}" aria-pressed="${mineOnly}">
        <span class="flag" aria-hidden="true">${flagFor(fav)}</span> ${mineOnly ? 'Showing' : 'My matches'}: ${escapeHtml(fav)}
      </button>
    `;
    toolbar.querySelector('.sched-mine').addEventListener('click', () => {
      // Toggle the filter; drop the date so we re-anchor on the next relevant day.
      setRoute('schedule', mineOnly ? {} : { mine: '1' });
    });
    root.appendChild(toolbar);
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
    const playsToday = favDates.has(d);
    btn.className = 'day-pill' + (d === active ? ' is-active' : '') + (playsToday ? ' has-fav' : '');
    btn.dataset.date = d;
    const [y, m, day] = d.split('-').map(Number);
    const dateObj = new Date(y, m - 1, day);
    const dow = dateObj.toLocaleDateString(undefined, { weekday: 'short' });
    const md = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const favDot = playsToday ? '<span class="fav-dot" aria-label="Your team plays" title="Your team plays">★</span>' : '';
    btn.innerHTML = `<span class="dow">${escapeHtml(dow)}</span><span class="md">${escapeHtml(md)}</span><span class="cnt">${byDate.get(d).length}</span>${favDot}`;
    btn.addEventListener('click', () => setRoute('schedule', mineOnly ? { date: d, mine: '1' } : { date: d }));
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
    list.appendChild(scheduleCard(m, venueById, fav));
  }
  root.appendChild(list);
}

function scheduleCard(match, venueById, fav) {
  const card = document.createElement('a');
  card.className = 'schedule-card';
  const isFav = !!fav && (match.team_a === fav || match.team_b === fav);
  if (isFav) card.classList.add('is-fav');
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
  const favBadge = '<span class="fav-badge" aria-label="Your team" title="Your team">★</span>';
  card.innerHTML = `
    <div class="sched-time">
      <div class="time">${escapeHtml(kickoff.time)}</div>
      <div class="muted tz">${escapeHtml(kickoff.tz)}</div>
    </div>
    <div class="sched-teams">
      <div class="line${fav && aTeam === fav ? ' is-fav-team' : ''}"><span class="flag" aria-hidden="true">${flagFor(aTeam)}</span>${escapeHtml(aTeam)}${fav && aTeam === fav ? favBadge : ''}</div>
      <div class="line${fav && bTeam === fav ? ' is-fav-team' : ''}"><span class="flag" aria-hidden="true">${flagFor(bTeam)}</span>${escapeHtml(bTeam)}${fav && bTeam === fav ? favBadge : ''}</div>
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
