import { escapeHtml, escapeAttr } from '../lib/escape.js';
/* when-where-watch.js — kickoff local time + venue + a full "Where to watch"
   panel: exact channel chips per language, clickable Watch buttons (deep-linked
   to each service's WC-2026 hub — per-match URLs are app-gated/not public), a
   FREE badge on Tubi's announced free matches, the vMVPDs that carry the linear
   channels, and a LIVE state tied to kickoff_utc. */

// Streaming destinations. Per-match deep links aren't publicly addressable, so
// these point at each service's live/WC hub (one tap to the right place).
const SVC = {
  foxOne:    { label: 'Fox One',        url: 'https://www.foxsports.com/live' },
  foxApp:    { label: 'Fox Sports app', url: 'https://www.foxsports.com/' },
  tubi:      { label: 'FREE on Tubi · 4K', url: 'https://tubitv.com/' },
  peacock:   { label: 'Peacock',        url: 'https://www.peacocktv.com/' },
  telemundo: { label: 'Telemundo app',  url: 'https://www.telemundodeportes.com/' },
};
const VMVPDS = [
  { label: 'YouTube TV', url: 'https://tv.youtube.com/' },
  { label: 'Fubo', url: 'https://www.fubo.tv/' },
  { label: 'Hulu + Live TV', url: 'https://www.hulu.com/live-tv' },
  { label: 'Sling TV', url: 'https://www.sling.com/' },
  { label: 'DirecTV Stream', url: 'https://www.directv.com/stream/' },
];
// Tubi's announced FREE live matches (+ the opening ceremony). Everything else
// is paid/auth (Fox One / Fox Sports app). Per Tubi's 2026 free slate.
const TUBI_FREE = new Set([1, 4]);
const LIVE_WINDOW_MS = 135 * 60 * 1000; // ~kickoff → full time + stoppage

export function whenWhereWatch(match, scheduleFull, venues) {
  const section = document.createElement('div');
  section.className = 'section';
  section.innerHTML = '<h2>When &amp; where &amp; how to watch</h2>';

  // Match by TEAM NAMES (both orientations), NOT by a team-pair match_id: group
  // schedule rows are keyed by team pair, but KNOCKOUT rows are keyed by slot ids
  // (e.g. "M080__1L__vs__3_EHIJK") even though they still carry team_a/team_b once
  // resolved — so a match_id lookup silently misses every knockout fixture and
  // buries the kickoff/venue/broadcast that DO exist on the row.
  const row = (scheduleFull || []).find((r) =>
    (r.team_a === match.team_a && r.team_b === match.team_b)
    || (r.team_a === match.team_b && r.team_b === match.team_a));
  const venue = row && (venues || []).find((v) => v.id === row.venue_id);
  const body = document.createElement('div');
  body.className = 'when-where-watch';

  if (!row) {
    body.innerHTML = '<p class="muted">Kickoff time + venue not yet assigned.</p>';
    section.appendChild(body);
    return section;
  }

  const localTime = formatLocal(row.kickoff_utc);
  const broadcast = row.broadcast?.us || {};
  body.innerHTML = `
    <div class="kv"><span class="k">Kickoff</span><span class="v">${escapeHtml(localTime)}</span></div>
    <div class="kv"><span class="k">Venue</span><span class="v">${escapeHtml(venue ? `${venue.name} · ${venue.city}` : 'Venue TBA')}</span></div>
  `;
  section.appendChild(body);
  section.appendChild(watchPanel(row, broadcast));
  return section;
}

function watchPanel(row, broadcast) {
  const wrap = document.createElement('div');
  wrap.className = 'watch-panel';
  const engChan = channelName(broadcast.english_channel);
  const spaChan = channelName(broadcast.spanish_channel);
  const free = TUBI_FREE.has(row.match_number);
  const state = liveState(row.kickoff_utc);
  const liveBadge = state === 'live' ? '<span class="watch-live">🔴 LIVE</span>' : '';

  const engStreams = [btn(SVC.foxOne), btn(SVC.foxApp), free ? btn(SVC.tubi, 'watch-free') : ''].join('');
  const spaStreams = [btn(SVC.peacock), btn(SVC.telemundo)].join('');
  const alsoOn = VMVPDS.map((v) => `<a class="watch-vmvpd" href="${escapeAttr(v.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v.label)}</a>`).join(' · ');

  wrap.innerHTML = `
    <div class="watch-head">Where to watch ${liveBadge}</div>
    <div class="watch-row">
      <span class="watch-lang">English</span>
      ${chip(engChan)}
      <span class="watch-btns">${engStreams}</span>
    </div>
    <div class="watch-row">
      <span class="watch-lang">Español</span>
      ${chip(spaChan)}
      <span class="watch-btns">${spaStreams}</span>
    </div>
    <div class="watch-also"><span class="watch-also-k">Also on</span> ${alsoOn}</div>
  `;
  return wrap;
}

function btn(svc, extra = '') {
  return `<a class="watch-btn ${extra}" href="${escapeAttr(svc.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(svc.label)}</a>`;
}

function chip(name) {
  const key = /fs1/i.test(name) ? 'fs1'
    : /\bfox\b/i.test(name) && !name.includes('/') ? 'fox'
    : /universo/i.test(name) && !/telemundo/i.test(name) ? 'uni'
    : /telemundo/i.test(name) ? 'tel'
    : 'generic';
  return `<span class="chan-chip chan-${key}">${escapeHtml(name)}</span>`;
}

// Strip any " · stream …" suffix the scraper appends, leaving just the channel(s).
function channelName(raw) {
  if (!raw) return 'TBA';
  return String(raw).split('·')[0].trim() || 'TBA';
}

function liveState(iso) {
  const k = Date.parse(iso || '');
  if (Number.isNaN(k)) return null;
  const now = Date.now();
  if (now < k) return 'upcoming';
  if (now <= k + LIVE_WINDOW_MS) return 'live';
  return 'past';
}

function formatLocal(iso) {
  if (!iso) return 'Kickoff TBA';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const dateStr = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(d);
    const timeStr = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(d);
    const tz = (Intl.DateTimeFormat(undefined).resolvedOptions().timeZone || '').split('/').pop();
    return `${dateStr} · ${timeStr}${tz ? ' ' + tz : ''}`;
  } catch {
    return iso;
  }
}
