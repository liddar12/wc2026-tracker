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
import { largeMatchCard } from '../components/large-match-card.js';
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
      const d = utcDateISO(row.kickoff_utc);
      if (d) favDates.add(d);
    }
  }
  const mineAvailable = favDates.size > 0;
  const mineOnly = mineAvailable && params.mine === '1';

  // Group by the match's UTC calendar date — the canonical FIFA "match day".
  // We deliberately do NOT bucket by the viewer's local day: in US timezones a
  // 19:00/02:00 UTC opener split would scatter a single tournament day across
  // two pills (e.g. an 8pm-Central kickoff sliding back onto the prior date).
  // Kickoff *times* are still shown in the viewer's local zone on each card.
  const byDate = new Map();
  for (const row of schedule) {
    if (!row?.kickoff_utc) continue;
    if (mineOnly && !isFavMatch(row)) continue;
    const dayKey = utcDateISO(row.kickoff_utc);
    if (!dayKey) continue;
    if (!byDate.has(dayKey)) byDate.set(dayKey, []);
    byDate.get(dayKey).push(row);
  }
  const dates = [...byDate.keys()].sort();

  const todayISO = new Date().toISOString().slice(0, 10);
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

  // Match list — large cards (Apple Sports style) per Phase 4B + Q2 auto-density.
  // Schedule's day-view typically has 2-8 matches per day, so large cards work well.
  const list = document.createElement('div');
  list.className = 'lcard-stack';
  const matches = (byDate.get(active) || []).slice().sort((a, b) =>
    String(a.kickoff_utc).localeCompare(String(b.kickoff_utc))
  );

  for (const m of matches) {
    const venue = venueById.get(m.venue_id);
    const broadcast = m.broadcast?.us || {};
    const channelLabel = broadcast.english_channel || broadcast.spanish_channel || null;
    const enriched = { ...m, venue_label: venue ? `${venue.name}, ${venue.city}` : (m.venue_id || '') };
    const card = largeMatchCard(enriched, {
      favorite: fav,
      extraMeta: channelLabel,
      onTap: (mm) => {
        if (!isSlotPlaceholder(mm.team_a) && !isSlotPlaceholder(mm.team_b)) {
          location.hash = `#/matchup/team_a/${encodeURIComponent(mm.team_a)}/team_b/${encodeURIComponent(mm.team_b)}`;
        }
      },
    });
    list.appendChild(card);
  }
  root.appendChild(list);
}

function isSlotPlaceholder(s) {
  if (typeof s !== 'string') return true;
  return /^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/.test(s);
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
  // Days are bucketed by UTC date, but kickoff times are shown in the viewer's
  // local zone. When those disagree (e.g. a 02:00 UTC kickoff that's the night
  // before locally), surface the local date so the time isn't misread.
  const localDayHint = (utcDateISO(match.kickoff_utc) !== toLocalDateISO(match.kickoff_utc))
    ? shortLocalDate(match.kickoff_utc) : '';
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
      ${localDayHint ? `<div class="muted sched-localday">${escapeHtml(localDayHint)}</div>` : ''}
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

function utcDateISO(iso) {
  // YYYY-MM-DD of the kickoff in EASTERN TIME — FIFA's canonical "match day".
  // (Despite the function name kept for compatibility, we bucket by ET, not
  // UTC, so a 10 PM ET / 02:00 UTC June 11 match stays on opening day instead
  // of sliding onto June 12.) WC26 runs fully inside EDT (UTC-4).
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    // Shift to ET by subtracting 4 hours, then take the ISO date.
    const et = new Date(d.getTime() - 4 * 60 * 60 * 1000);
    return et.toISOString().slice(0, 10);
  } catch { return null; }
}
function shortLocalDate(iso) {
  // e.g. "Thu, Jun 11" in the viewer's local zone.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return ''; }
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
