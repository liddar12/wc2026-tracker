/* schedule-view.js — browse the tournament by date.
 *
 * Route:    #/schedule[/date/YYYY-MM-DD]
 * Default:  today, if a match is today; otherwise the day with the next
 *           upcoming match; otherwise opening day.
 *
 * Layout:   horizontal scrollable day-picker strip + list of matches on the
 *           selected day with venue + local-time kickoff + broadcast tag.
 */
import { escapeHtml } from '../lib/escape.js';
import { t, fmtDate } from '../lib/i18n.js';
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { largeMatchCard, actualForCard } from '../components/large-match-card.js';
import { getFavoriteTeam } from '../favorites.js';
import { renderParlayOfDay } from '../components/parlay.js';

export function renderScheduleView(root, data, params) {
  const schedule = Array.isArray(data.scheduleFull) ? data.scheduleFull : [];
  const venues = Array.isArray(data.venues) ? data.venues : [];
  const venueById = new Map(venues.map((v) => [v.id, v]));

  if (!schedule.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = t('schedule.empty');
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
        <span class="flag" aria-hidden="true">${flagFor(fav)}</span> ${escapeHtml(mineOnly ? t('schedule.showing') : t('schedule.myMatches'))}: ${escapeHtml(fav)}
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
    const dow = fmtDate(dateObj, { weekday: 'short' });
    const md = fmtDate(dateObj, { month: 'short', day: 'numeric' });
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

  // Heading — render the local-date as a friendly long string, localized to the
  // selected language (fmtDate → es-MX when Spanish, en-US otherwise).
  const [ay, am, ad] = active.split('-').map(Number);
  const headingDate = fmtDate(new Date(ay, am - 1, ad), {
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
    // Attach the real result so finished/live matches show score digits.
    const found = actualForCard(data.actualResults, m);
    const card = largeMatchCard(enriched, {
      ...(found ? { actual: found.actual } : {}),
      ...(found?.mode ? { mode: found.mode } : {}),
      ...(found?.winner ? { winner: found.winner } : {}),
      ...(found?.method ? { method: found.method } : {}),
      favorite: fav,
      extraMeta: channelLabel,
      onTap: (match) => {
        if (!isSlotPlaceholder(match.team_a) && !isSlotPlaceholder(match.team_b)) {
          location.hash = `#/matchup/team_a/${encodeURIComponent(match.team_a)}/team_b/${encodeURIComponent(match.team_b)}`;
        }
      },
    });
    list.appendChild(card);
  }
  root.appendChild(list);

  // BR-8: Parlay of the Day at the bottom (today's games only; renders nothing
  // when there are no real-team matches today).
  root.appendChild(renderParlayOfDay(data));
}

function isSlotPlaceholder(s) {
  if (typeof s !== 'string') return true;
  return /^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/.test(s);
}

// NOTE: scheduleCard() / prettyStage() / formatKickoffLocal() were removed here
// (RJ30-9b) — they were dead code with no call sites in this file. The active
// renderScheduleView() uses largeMatchCard + actualForCard. The date helpers
// below (utcDateISO / shortLocalDate / toLocalDateISO / formatLocalDateISO) ARE
// still used by renderScheduleView and are retained.

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

