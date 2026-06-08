/* home-view.js — dashboard hub. Hero with countdown, last-updated stamp,
   today's matches, recent results, auth/group preview, Kalshi top movers,
   quick links to other tabs. */
import { escapeHtml } from '../lib/escape.js';
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { largeMatchCard } from '../components/large-match-card.js';
import { formatLastUpdated } from '../data-loader.js';
import {
  getCompetitionState,
  isSupabaseConfigured,
  fetchLeaderboard,
  EVERYONE_GROUP_ID
} from '../competition.js';
import { openAuth } from '../auth-modal.js';
import { startGuest } from '../toolbar-auth.js';
import { icon } from '../lib/icons.js';
import { getFavoriteTeam, setFavoriteTeam, allTeamNames, favoriteTeamGroup } from '../favorites.js';
import { topMovers as eloTopMovers } from '../live-elo.js';
import { loadGroupPicks, isStage1Complete, isStage2Complete } from '../group-picks-builder.js';
import { loadBracketDraft } from '../bracket-builder.js';

const OPENING_KEY = 'opening_match';

// Module-level interval so successive renderHome() calls cancel the previous
// ticker. Without this, route changes or pull-to-refresh would leak intervals.
let countdownIntervalId = null;
function stopCountdown() {
  if (countdownIntervalId != null) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
}
// Stop the ticker whenever the user navigates away from home. Bound once at
// module load — state:change fires for every route change.
if (typeof window !== 'undefined' && !window.__wc26HomeCountdownBound) {
  window.__wc26HomeCountdownBound = true;
  window.addEventListener('state:change', () => {
    const view = window.location.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
    if (view !== 'home') stopCountdown();
  });
  // Also pause when the tab is hidden — saves battery and avoids drift on
  // throttled background timers.
  document.addEventListener?.('visibilitychange', () => {
    if (document.hidden) stopCountdown();
  });
}

export function renderHome(root, data) {
  stopCountdown();
  root.innerHTML = '';
  // v2 design tokens are now applied globally on <html> per PLAN_UI_REFRESH
  // Phase 2 rollout. No per-view opt-in needed.
  if (!data) {
    const p = document.createElement('p');
    p.className = 'loading';
    p.textContent = 'Loading…';
    root.appendChild(p);
    return;
  }
  root.appendChild(renderHero(data));
  // R14: primary "Make your prediction" CTA — Home had no path into the Play
  // funnel (the core action), and the Quick Links grid omitted Play entirely.
  root.appendChild(renderPlayCta());
  root.appendChild(renderAuthSlot(data));
  root.appendChild(renderFavoriteTeamSection(data));
  const favKalshi = renderFavKalshiCard(data);
  if (favKalshi) root.appendChild(favKalshi);
  const motd = renderMatchOfTheDayChip(data);
  if (motd) root.appendChild(motd);
  root.appendChild(renderTodaySection(data));
  const movers = renderMoversSection(data);
  if (movers) root.appendChild(movers);
  const eloMovers = renderEloMoversSection(data);
  if (eloMovers) root.appendChild(eloMovers);
  root.appendChild(renderRecentSection(data));
  root.appendChild(renderQuickLinks());
}

function renderHero(data) {
  const opening = data.schedule?.[OPENING_KEY];
  const meta = data.meta || {};
  const wrap = document.createElement('section');
  wrap.className = 'home-hero';

  const openingMatch = (data.scheduleFull || []).find(
    (m) => m.match_number === 1 || (m.team_a === 'Mexico' && m.team_b === 'South Africa')
  );
  const openingDate = openingMatch?.kickoff_utc || (opening?.date ? `${opening.date}T19:00:00Z` : null);

  // Defensive: meta.data_version is only bumped by some cron jobs, but other
  // data files carry their own timestamps that may be fresher. Show the most
  // recent one so users see the truest "last refresh" time.
  const freshestIso = pickFreshestTimestamp(data);

  wrap.innerHTML = `
    <div class="home-hero-top">
      <div class="home-hero-eyebrow">FIFA World Cup 2026</div>
      <div class="home-hero-title">${escapeHtml(meta.dates || '11 June – 19 July 2026')}</div>
      <div class="home-hero-sub">${escapeHtml(meta.hosts?.join(' · ') || 'USA · Canada · Mexico')}</div>
    </div>
    ${openingDate ? renderCountdownShell(opening) : ''}
    <button class="home-hero-updated" id="home-updated-btn" type="button" aria-haspopup="dialog" aria-expanded="false">
      <span class="home-hero-dot" aria-hidden="true"></span>
      Data updated <strong>${escapeHtml(formatLastUpdated(freshestIso))}</strong>
      ${freshestIso ? `<span class="muted"> · ${escapeHtml(prettyIso(freshestIso))}</span>` : ''}
      <span class="home-hero-info" aria-hidden="true">ⓘ</span>
    </button>
    <div class="home-hero-freshness" id="home-freshness-popover" hidden role="dialog" aria-label="Per-feed freshness"></div>
  `;

  // Per-feed freshness popover wiring
  const updatedBtn = wrap.querySelector('#home-updated-btn');
  const popover = wrap.querySelector('#home-freshness-popover');
  if (updatedBtn && popover) {
    updatedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !popover.hidden;
      if (open) {
        popover.hidden = true;
        updatedBtn.setAttribute('aria-expanded', 'false');
      } else {
        popover.innerHTML = renderFreshnessPopover(data);
        popover.hidden = false;
        updatedBtn.setAttribute('aria-expanded', 'true');
      }
    });
    // Click-outside dismisses
    document.addEventListener('click', (e) => {
      if (popover.hidden) return;
      if (!popover.contains(e.target) && !updatedBtn.contains(e.target)) {
        popover.hidden = true;
        updatedBtn.setAttribute('aria-expanded', 'false');
      }
    }, { once: false });
  }

  if (openingDate) {
    startCountdownTicker(wrap, openingDate);
  }
  return wrap;
}

function renderFreshnessPopover(data) {
  const feeds = [
    { key: 'schedule',  label: 'Schedule',       iso: data?.meta?.data_version || data?.scheduleFull?.__meta__?.updated_at },
    { key: 'kalshi',    label: 'Kalshi markets', iso: data?.markets?.updated_at },
    { key: 'weather',   label: 'Weather',        iso: data?.weather?.__meta__?.updated_at || data?.weather?.updated_at },
    { key: 'lineups',   label: 'Lineups',        iso: data?.lineups?.__meta__?.updated_at || data?.lineups?.updated_at },
    { key: 'injuries',  label: 'Injuries',       iso: data?.injuries?.__meta__?.updated_at || data?.injuries?.updated_at },
    { key: 'h2h',       label: 'Head-to-head',   iso: data?.h2h?.__meta__?.updated_at || data?.h2h?.updated_at },
    { key: 'form',      label: 'Form',           iso: data?.form?.__meta__?.updated_at || data?.form?.updated_at },
    { key: 'scorers',   label: 'Scorers',        iso: data?.scorers?.__meta__?.updated_at || data?.scorers?.updated_at },
    { key: 'referees',  label: 'Referees',       iso: data?.referees?.__meta__?.updated_at || data?.referees?.updated_at },
    { key: 'kits',      label: 'Team colors',    iso: data?.teamColors?.__meta__?.updated_at },
    { key: 'actual',    label: 'Match results',  iso: data?.actualResults?.last_updated },
  ];
  const rows = feeds.map((f) => `
    <li class="freshness-row">
      <span class="freshness-label">${escapeHtml(f.label)}</span>
      <span class="freshness-time">${f.iso ? escapeHtml(formatLastUpdated(f.iso)) : '<span class="muted">never</span>'}</span>
    </li>
  `).join('');
  return `
    <div class="freshness-card">
      <h3>Data freshness</h3>
      <ul class="freshness-list">${rows}</ul>
      <p class="muted" style="font-size:11px; margin:8px 0 0;">Updates hourly from openfootball, Kalshi, Wikipedia, and FIFA. Tap to refresh.</p>
    </div>
  `;
}

function renderCountdownShell(opening) {
  const matchTitle = opening?.match || 'Opening match';
  const venue = opening?.venue ? ` · ${escapeHtml(opening.venue)}` : '';
  // Numbers populated by startCountdownTicker — initial values are placeholders.
  return `
    <div class="home-countdown" role="timer" aria-label="Time until opening match" aria-live="off">
      <div class="home-countdown-label" data-cd="label">Kicks off in</div>
      <div class="home-countdown-cells">
        <div class="cd-cell"><div class="cd-num" data-cd="d">—</div><div class="cd-lbl">days</div></div>
        <div class="cd-cell"><div class="cd-num" data-cd="h">—</div><div class="cd-lbl">hrs</div></div>
        <div class="cd-cell"><div class="cd-num" data-cd="m">—</div><div class="cd-lbl">min</div></div>
        <div class="cd-cell"><div class="cd-num" data-cd="s">—</div><div class="cd-lbl">sec</div></div>
      </div>
      <div class="home-countdown-game muted">${escapeHtml(matchTitle)}${venue}</div>
    </div>
  `;
}

function pickFreshestTimestamp(data) {
  // Check every plausible "last updated" field across the JSON feeds and
  // return the most recent one as an ISO string. Different scrapers use
  // different conventions: kalshi/markets uses top-level updated_at, most
  // others use __meta__.updated_at, meta.json uses data_version. Read both
  // shapes for each feed so nothing's silently ignored.
  const pickTwo = (obj) => [obj?.updated_at, obj?.__meta__?.updated_at];
  const candidates = [
    data?.meta?.data_version,
    ...pickTwo(data?.markets),
    data?.actualResults?.last_updated,
    ...pickTwo(data?.injuries),
    ...pickTwo(data?.weather),
    ...pickTwo(data?.lineups),
    ...pickTwo(data?.scorers),
    ...pickTwo(data?.h2h),
    ...pickTwo(data?.form),
    ...pickTwo(data?.referees),
  ].filter(Boolean);
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestMs = Date.parse(best) || 0;
  for (const iso of candidates) {
    const ms = Date.parse(iso) || 0;
    if (ms > bestMs) { bestMs = ms; best = iso; }
  }
  return best;
}

function etDateISO(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const et = new Date(d.getTime() - 4 * 60 * 60 * 1000);
  return et.toISOString().slice(0, 10);
}

function prettyIso(iso) {
  // Normalize "...+00:00" / "...Z" / "...T..." into "YYYY-MM-DD HH:MM Z".
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}Z`;
}

function computeCountdown(iso) {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = target - now;
  const elapsed = diffMs <= 0;
  let abs = Math.abs(diffMs);
  const days = Math.floor(abs / 86400000); abs -= days * 86400000;
  const hours = Math.floor(abs / 3600000); abs -= hours * 3600000;
  const minutes = Math.floor(abs / 60000); abs -= minutes * 60000;
  const seconds = Math.floor(abs / 1000);
  return { days, hours, minutes, seconds, elapsed };
}

function startCountdownTicker(wrap, openingIso) {
  const label = wrap.querySelector('[data-cd="label"]');
  const dEl = wrap.querySelector('[data-cd="d"]');
  const hEl = wrap.querySelector('[data-cd="h"]');
  const mEl = wrap.querySelector('[data-cd="m"]');
  const sEl = wrap.querySelector('[data-cd="s"]');
  if (!label || !dEl || !hEl || !mEl || !sEl) return;

  const pad2 = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const cd = computeCountdown(openingIso);
    if (cd.elapsed) {
      label.textContent = 'Tournament started';
    } else {
      label.textContent = 'Kicks off in';
    }
    // Days uncapped (no zero-pad for readability); time units zero-padded.
    dEl.textContent = String(cd.days);
    hEl.textContent = pad2(cd.hours);
    mEl.textContent = pad2(cd.minutes);
    sEl.textContent = pad2(cd.seconds);
  };
  tick();
  countdownIntervalId = setInterval(tick, 1000);
}

function renderAuthSlot(data) {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  const comp = getCompetitionState();
  const configured = isSupabaseConfigured();
  if (!configured) {
    wrap.innerHTML = `
      <div class="home-card home-card-auth">
        <h2 class="home-card-title">Guest mode</h2>
        <p class="muted">Group competitions require login (not configured on this build). Your picks save locally.</p>
        <div class="home-card-cta">
          <button class="pick-btn" data-go="picks">My Picks →</button>
        </div>
      </div>
    `;
  } else if (comp.user) {
    const groupCount = comp.groups.length;
    const activeName = comp.activeGroup?.name || 'No active group';
    wrap.innerHTML = `
      <div class="home-card home-card-auth">
        <h2 class="home-card-title">Signed in</h2>
        <p class="muted">${escapeHtml(comp.profile?.username || comp.user.email || 'You')} · ${groupCount} pool${groupCount === 1 ? '' : 's'} · Active: ${escapeHtml(activeName)}</p>
        <div class="home-card-cta">
          <button class="pick-btn" data-go="my-brackets">My Brackets →</button>
          <button class="pick-btn pick-btn-secondary" data-go="pools">Manage pools →</button>
        </div>
      </div>
    `;
    void renderActiveLeaderboard(wrap, data).catch(() => {});
  } else {
    wrap.innerHTML = `
      <div class="home-card home-card-auth">
        <h2 class="home-card-title">Join a pool or play solo</h2>
        <p class="muted">Sign in to create or join bracket pools (public or private). Or continue anonymously to track picks locally.</p>
        <div class="home-card-cta">
          <button class="pick-btn" data-go-signin>Sign In / Sign Up</button>
          <button class="pick-btn pick-btn-secondary" data-go-guest>Continue Anonymously</button>
        </div>
        <div class="home-card-cta" style="margin-top: 6px;">
          <button class="pick-btn pick-btn-secondary" data-go="pools">Browse public pools →</button>
        </div>
      </div>
    `;
  }

  wrap.addEventListener('click', (e) => {
    const tgt = e.target.closest('[data-go]');
    if (tgt) {
      const r = tgt.dataset.go;
      if (r === 'my-brackets') setRoute('my-brackets', {});
      else if (r === 'brackets') setRoute('brackets', {});
      else setRoute(r, {});
      return;
    }
    if (e.target.closest('[data-go-signin]')) {
      // R16: open the auth lightbox directly on the sign-in form. (The old
      // path set a panel mode then clicked the toolbar button, but the menu
      // ignored the mode and dead-ended on the generic entry screen.)
      openAuth('signin');
      return;
    }
    if (e.target.closest('[data-go-guest]')) {
      // R20 (RC4): prompt for a display name (consistent with the modal's guest
      // path) instead of silently creating a nameless "Guest".
      void startGuest();
    }
  });
  return wrap;
}

async function renderActiveLeaderboard(wrap, data) {
  const rows = await fetchLeaderboard(data);
  if (!rows.length) return;
  const top = rows.slice(0, 5);
  const ol = document.createElement('div');
  ol.className = 'home-card home-card-leaderboard';
  const isEveryone = getCompetitionState().activeGroup?.id === EVERYONE_GROUP_ID;
  ol.innerHTML = `
    <h2 class="home-card-title">Active group leaderboard</h2>
    <ol class="home-leaderboard">
      ${top.map((r, i) => `<li><span class="lb-rank">${i + 1}</span> <span class="lb-name">${escapeHtml(r.username)}</span> <span class="lb-score">${r.score} pts</span></li>`).join('')}
    </ol>
    ${isEveryone ? '<p class="muted" style="margin: 8px 0 0; font-size: 11px;">Scores update as matches are played.</p>' : ''}
  `;
  wrap.appendChild(ol);
}

function renderFavoriteTeamSection(data) {
  const comp = getCompetitionState();
  // Gate the picker behind being signed in — guests can still get this later.
  const requireAuth = isSupabaseConfigured() && !comp.user;
  const fav = getFavoriteTeam();
  const grp = favoriteTeamGroup(data);
  const wrap = document.createElement('section');
  wrap.className = 'home-section';

  if (requireAuth && !fav) {
    // Don't render the picker for guests — keeps the home page tighter.
    return document.createDocumentFragment();
  }

  if (!fav) {
    wrap.innerHTML = `
      <div class="home-card home-card-favorite">
        <h2 class="home-card-title">Pick your favorite team</h2>
        <p class="muted" style="margin: 0 0 8px;">When set, Matches and Groups default to this team's group.</p>
        <button class="pick-btn" id="fav-open">Choose team →</button>
      </div>
    `;
    wrap.querySelector('#fav-open').addEventListener('click', () => openTeamPicker(wrap, data));
    return wrap;
  }

  wrap.innerHTML = `
    <div class="home-card home-card-favorite">
      <h2 class="home-card-title">Your team</h2>
      <div class="fav-current">
        <span class="fav-flag" aria-hidden="true">${flagFor(fav)}</span>
        <div class="fav-meta">
          <div class="fav-name">${escapeHtml(fav)}</div>
          <div class="muted" style="font-size: 12px;">${grp ? `Group ${escapeHtml(grp)}` : 'Not in tournament groups'}</div>
        </div>
        <div class="fav-actions">
          ${grp ? `<button class="pick-btn pick-btn-secondary" data-jump-group="${escapeHtml(grp)}">View group →</button>` : ''}
          <button class="pick-btn pick-btn-secondary" id="fav-change">Change</button>
          <button class="pick-btn pick-btn-secondary" id="fav-clear">Clear</button>
        </div>
      </div>
    </div>
  `;
  wrap.addEventListener('click', (e) => {
    const jump = e.target.closest('[data-jump-group]');
    if (jump) {
      setRoute('group', { group: jump.dataset.jumpGroup });
      return;
    }
    if (e.target.closest('#fav-change')) {
      openTeamPicker(wrap, data);
      return;
    }
    if (e.target.closest('#fav-clear')) {
      setFavoriteTeam(null);
    }
  });
  return wrap;
}

function openTeamPicker(wrap, data) {
  const teams = allTeamNames(data);
  if (!teams.length) return;
  // Reuse the same card slot — render a search + grid.
  const card = wrap.querySelector('.home-card-favorite') || wrap;
  card.innerHTML = `
    <h2 class="home-card-title">Pick your favorite team</h2>
    <input id="fav-search" class="auth-input" placeholder="Search teams…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <div class="fav-grid" id="fav-grid" role="listbox" aria-label="Teams"></div>
    <div style="display:flex; justify-content: flex-end; margin-top: 8px;">
      <button class="pick-btn pick-btn-secondary" id="fav-cancel">Cancel</button>
    </div>
  `;
  const grid = card.querySelector('#fav-grid');
  const search = card.querySelector('#fav-search');
  const render = (q) => {
    const needle = String(q || '').trim().toLowerCase();
    const filtered = needle ? teams.filter((t) => t.toLowerCase().includes(needle)) : teams;
    grid.innerHTML = filtered.map((t) => `
      <button type="button" class="fav-team-chip" data-team="${escapeHtml(t)}" role="option">
        <span class="fav-flag" aria-hidden="true">${flagFor(t)}</span>
        <span>${escapeHtml(t)}</span>
      </button>
    `).join('');
  };
  render('');
  search.addEventListener('input', (e) => render(e.target.value));
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-team]');
    if (!b) return;
    setFavoriteTeam(b.dataset.team);
  });
  card.querySelector('#fav-cancel').addEventListener('click', () => {
    // Re-render to whatever the current favorite state shows.
    window.dispatchEvent(new CustomEvent('state:change'));
  });
  search.focus();
}

function renderTodaySection(data) {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  // Bucket by the match's UTC calendar day — the canonical FIFA "match day",
  // matching the Schedule tab. (Kickoff times are still rendered in the
  // viewer's local zone.) Bucketing by device-local day would scatter a single
  // tournament day across two dates in US timezones.
  // Bucket "today" by FIFA's canonical ET date (UTC-4 during the tournament),
  // matching the Schedule tab's day pills and how FIFA/ESPN/Apple Sports
  // group matches. A 10 PM ET June 11 kickoff stays on June 11 instead of
  // sliding onto June 12 just because it crosses midnight in UTC.
  const todayIso = etDateISO(new Date().toISOString());
  const scheduleFull = data.scheduleFull || [];
  const todays = scheduleFull
    .filter((m) => etDateISO(m.kickoff_utc) === todayIso)
    .sort((a, b) => String(a.kickoff_utc).localeCompare(String(b.kickoff_utc)));
  const upcoming = todays.length
    ? todays
    : scheduleFull
        .filter((m) => m.kickoff_utc && new Date(m.kickoff_utc).getTime() >= Date.now())
        .sort((a, b) => String(a.kickoff_utc).localeCompare(String(b.kickoff_utc)))
        .slice(0, 3);
  const heading = todays.length ? "Today's matches" : 'Up next';
  if (!upcoming.length) {
    wrap.innerHTML = `<div class="home-card"><h2 class="home-card-title">${heading}</h2><p class="muted">No upcoming matches in schedule.</p></div>`;
    return wrap;
  }

  // Heading + CTA in a small card; the actual matches go in a vertical
  // scroll-snap stack of large match cards (Apple Sports inspired).
  const head = document.createElement('div');
  head.className = 'home-card';
  head.style.marginBottom = '12px';
  head.innerHTML = `
    <h2 class="home-card-title">${heading}</h2>
    <div class="home-card-cta">
      <button class="pick-btn pick-btn-secondary" data-go="schedule">Full schedule →</button>
    </div>
  `;
  head.addEventListener('click', (e) => {
    const tgt = e.target.closest('[data-go]');
    if (tgt) setRoute(tgt.dataset.go, {});
  });
  wrap.appendChild(head);

  // B3 + favorite reorder: LIVE > favorite > everything else (by time).
  const fav = getFavoriteTeam();
  const isLive = (m) => {
    const k = Date.parse(m.kickoff_utc || '');
    if (!Number.isFinite(k)) return false;
    const now = Date.now();
    return k <= now && k + 2 * 3600 * 1000 > now;
  };
  const reorderedList = [
    ...upcoming.filter(isLive),
    ...upcoming.filter((m) => !isLive(m) && fav && (m.team_a === fav || m.team_b === fav)),
    ...upcoming.filter((m) => !isLive(m) && !(fav && (m.team_a === fav || m.team_b === fav))),
  ];

  const list = document.createElement('div');
  list.className = 'lcard-stack';
  for (const m of reorderedList.slice(0, 6)) {
    list.appendChild(largeMatchCard(m, {
      onTap: (match) => {
        if (match.team_a && match.team_b && !isPlaceholder(match.team_a) && !isPlaceholder(match.team_b)) {
          location.hash = `#/matchup/team_a/${encodeURIComponent(match.team_a)}/team_b/${encodeURIComponent(match.team_b)}`;
        }
      },
    }));
  }
  wrap.appendChild(list);
  return wrap;
}

function isPlaceholder(name) {
  if (typeof name !== 'string') return true;
  return /^\d[A-L]$|^3 [A-L]+$|^W\d+$|^L\d+$/.test(name);
}

function homeMatchRow(m, fav) {
  const t = new Date(m.kickoff_utc);
  const time = isNaN(t) ? 'TBA' : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isPlaceholder = typeof m.team_a === 'string' && /^[A-L]\d|\dW|\dL|W\d|L\d|^3\s|^\dW|^\dL|^1[A-L]|^2[A-L]|^3 /.test(m.team_a);
  const fa = isPlaceholder ? '·' : flagFor(m.team_a);
  const fb = isPlaceholder ? '·' : flagFor(m.team_b);
  const clickable = !isPlaceholder;
  const isFav = !!fav && !isPlaceholder && (m.team_a === fav || m.team_b === fav);
  return `
    <div class="home-match-row${isFav ? ' is-fav' : ''}" ${clickable ? `data-mid="${escapeHtml(m.match_id)}" data-team-a="${escapeHtml(m.team_a)}" data-team-b="${escapeHtml(m.team_b)}" tabindex="0" role="button"` : ''}>
      <div class="hmr-time">${escapeHtml(time)}</div>
      <div class="hmr-teams">${fa} <strong>${escapeHtml(m.team_a)}</strong> vs <strong>${escapeHtml(m.team_b)}</strong> ${fb}${isFav ? ' <span class="fav-badge" aria-label="Your team" title="Your team">★</span>' : ''}</div>
      <div class="hmr-stage muted">${escapeHtml(prettyStage(m))}</div>
    </div>
  `;
}

function prettyStage(m) {
  if (m.stage === 'group') return `Group ${m.group || ''}`.trim();
  return {
    round_of_32: 'R32',
    round_of_16: 'R16',
    quarterfinals: 'QF',
    semifinals: 'SF',
    third_place: '3rd',
    final: 'Final',
  }[m.stage] || m.stage || '';
}

function renderMatchOfTheDayChip(data) {
  // Score each "today" match by upset risk × stage weight × composite-gap inverse
  // (close games + late stage + high upset signal = high importance).
  const todayIso = etDateISO(new Date().toISOString());
  const candidates = (data.scheduleFull || [])
    .filter((m) => etDateISO(m.kickoff_utc) === todayIso && m.stage === 'group');
  if (!candidates.length) return null;
  const stageWeight = { group: 1, round_of_32: 2, round_of_16: 3, quarterfinals: 4, semifinals: 5, third_place: 4, final: 6 };
  const scored = candidates.map((m) => {
    // Pull the group_matchups composite gap if available
    const gm = data.groupMatchups?.[m.group];
    const match = gm?.matches?.find((x) =>
      (x.team_a === m.team_a && x.team_b === m.team_b) ||
      (x.team_a === m.team_b && x.team_b === m.team_a));
    if (!match) return { m, score: 0 };
    const gap = Math.abs(match.gap || 5);
    const closeness = 1 / (gap + 1);  // smaller gap → higher score
    const upsetIndicators = match.upset_risk?.indicators?.length || 0;
    const sw = stageWeight[m.stage] || 1;
    return { m, match, score: closeness * sw * (1 + 0.4 * upsetIndicators) };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === 0) return null;
  const m = best.m;
  const wrap = document.createElement('section');
  wrap.className = 'home-card motd-card';
  wrap.style.marginBottom = '12px';
  const t = new Date(m.kickoff_utc);
  const time = isNaN(t) ? 'TBA' : t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const upsetLabel = best.match?.upset_risk?.indicators?.[0]?.label || 'Toss-up';
  wrap.innerHTML = `
    <h2 class="home-card-title">⭐ Don't miss <span class="muted home-card-meta">${escapeHtml(upsetLabel)}</span></h2>
    <div class="motd-row">
      <div class="motd-teams">${flagFor(m.team_a)} <strong>${escapeHtml(m.team_a)}</strong> vs <strong>${escapeHtml(m.team_b)}</strong> ${flagFor(m.team_b)}</div>
      <div class="motd-meta muted">${escapeHtml(time)} · Group ${escapeHtml(m.group || '?')}</div>
    </div>
  `;
  wrap.addEventListener('click', () => {
    location.hash = `#/matchup/team_a/${encodeURIComponent(m.team_a)}/team_b/${encodeURIComponent(m.team_b)}`;
  });
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('tabindex', '0');
  return wrap;
}

function renderFavKalshiCard(data) {
  const fav = getFavoriteTeam();
  if (!fav) return null;
  const markets = data?.markets;
  const rows = Array.isArray(markets?.tournament_winner) ? markets.tournament_winner : [];
  const me = rows.find((r) => r.team === fav);
  if (!me) return null;
  const card = document.createElement('section');
  card.className = 'home-card home-card-fav-kalshi';
  card.style.marginBottom = '12px';
  const delta = typeof me.delta_24h_pp === 'number' ? me.delta_24h_pp : 0;
  const deltaCls = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : '';
  card.innerHTML = `
    <h2 class="home-card-title">Your team on Kalshi <span class="muted home-card-meta">winner market</span></h2>
    <div class="fav-kalshi-row">
      <div class="fav-kalshi-team">${flagFor(fav)} <strong>${escapeHtml(fav)}</strong></div>
      <div class="fav-kalshi-prob">${typeof me.prob_pct === 'number' ? me.prob_pct.toFixed(1) : '—'}%</div>
      <div class="fav-kalshi-delta ${deltaCls}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp <span class="muted" style="font-size:11px;">24h</span></div>
    </div>
    <p class="muted kalshi-attr">Tournament-winner odds via <a href="https://kalshi.com" target="_blank" rel="noopener">Kalshi</a></p>
  `;
  return card;
}

function renderMoversSection(data) {
  const markets = data.markets || {};
  // markets.json (scrape_kalshi.py output): { updated_at, source, tournament_winner: [{team, prob_pct, delta_24h_pp, sparkline}] }
  const rows = Array.isArray(markets.tournament_winner) ? markets.tournament_winner : [];
  const entries = rows
    .filter((r) => r && r.team && typeof r.prob_pct === 'number')
    .map((r) => ({
      team: r.team,
      prob_pct: r.prob_pct,
      delta_pp: typeof r.delta_24h_pp === 'number' ? r.delta_24h_pp : 0,
    }));
  if (!entries.length) return null;
  entries.sort((a, b) => Math.abs(b.delta_pp) - Math.abs(a.delta_pp));
  const movers = entries.filter((e) => Math.abs(e.delta_pp) > 0).slice(0, 6);
  const top = movers.length ? movers : entries.slice(0, 6); // fallback to top probabilities

  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  const movedLabel = movers.length ? 'Kalshi top movers' : 'Kalshi tournament winner odds';
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">${escapeHtml(movedLabel)} <span class="muted home-card-meta">${markets.updated_at ? escapeHtml(formatLastUpdated(markets.updated_at)) : ''}</span></h2>
      <div class="movers-strip">
        ${top.map((m) => `
          <a class="mover-chip" href="#/winner">
            <span class="mover-team">${flagFor(m.team)} ${escapeHtml(m.team)}</span>
            <span class="mover-prob">${m.prob_pct.toFixed(1)}%</span>
            <span class="mover-delta ${m.delta_pp >= 0 ? 'delta-up' : 'delta-down'}">${m.delta_pp >= 0 ? '+' : ''}${m.delta_pp.toFixed(1)}pp</span>
          </a>`).join('')}
      </div>
      <p class="muted kalshi-attr">Tournament winner markets via <a href="https://kalshi.com" target="_blank" rel="noopener">Kalshi</a></p>
    </div>
  `;
  return wrap;
}

function renderEloMoversSection(data) {
  const movers = eloTopMovers(data, 8).filter((m) => m.delta !== 0);
  if (!movers.length) return null;
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">Live Elo movers <span class="muted home-card-meta">tournament impact</span></h2>
      <div class="movers-strip">
        ${movers.map((m) => `
          <a class="mover-chip" href="#/team/name/${encodeURIComponent(m.name)}">
            <span class="mover-team">${flagFor(m.name)} ${escapeHtml(m.name)}</span>
            <span class="mover-prob">${m.currentElo}</span>
            <span class="mover-delta ${m.delta >= 0 ? 'delta-up' : 'delta-down'}">${m.delta >= 0 ? '+' : ''}${m.delta}</span>
          </a>`).join('')}
      </div>
      <p class="muted" style="font-size: 11px; margin: 6px 0 0;">Elo recomputed from completed match results in this tournament.</p>
    </div>
  `;
  return wrap;
}

function renderRecentSection(data) {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  const actual = data.actualResults || {};
  // actualResults shape: { group_stage: { 'A__vs__B': { score_a, score_b, ... } }, round_of_32: {...}, ... }
  const recents = [];
  for (const stage of ['final','third_place','semifinals','quarterfinals','round_of_16','round_of_32','group_stage']) {
    const tier = actual[stage] || {};
    for (const [key, rec] of Object.entries(tier)) {
      if (!rec || typeof rec !== 'object') continue;
      if (typeof rec.score_a !== 'number' || typeof rec.score_b !== 'number') continue;
      const [a, b] = key.split('__vs__');
      recents.push({ stage, a, b, sa: rec.score_a, sb: rec.score_b, when: rec.kickoff_utc || rec.played_at || '' });
    }
  }
  if (!recents.length) {
    wrap.innerHTML = `
      <div class="home-card">
        <h2 class="home-card-title">Recent results</h2>
        <p class="muted">No matches played yet. Tournament begins ${escapeHtml(data.schedule?.opening_match?.date || '11 June 2026')}.</p>
      </div>
    `;
    return wrap;
  }
  recents.sort((x, y) => String(y.when).localeCompare(String(x.when)));
  const top = recents.slice(0, 5);
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">Recent results</h2>
      <div class="home-match-list">
        ${top.map((r) => `
          <div class="home-match-row">
            <div class="hmr-time">${escapeHtml(r.when ? new Date(r.when).toLocaleDateString() : '')}</div>
            <div class="hmr-teams">${flagFor(r.a)} <strong>${escapeHtml(r.a)}</strong> ${r.sa}–${r.sb} <strong>${escapeHtml(r.b)}</strong> ${flagFor(r.b)}</div>
            <div class="hmr-stage muted">${escapeHtml(prettyStage({ stage: r.stage }))}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  return wrap;
}

function renderPlayCta() {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  // Progress-aware: reflect how far the user is through the funnel.
  let headline = 'Make your World Cup prediction';
  let sub = 'Three stages: rank the groups, pick the best thirds, play the knockouts.';
  try {
    const picks = loadGroupPicks(null);
    const draft = loadBracketDraft(null);
    const s1 = isStage1Complete(picks);
    const s2 = isStage2Complete(picks);
    const hasKo = draft && draft.picks && Object.keys(draft.picks).length > 0;
    if (s1 && s2 && hasKo) { headline = 'Finish & submit your bracket'; sub = "You're on the knockouts — lock it in."; }
    else if (s1 && s2) { headline = 'Continue to the knockout bracket'; sub = 'Stages 1 & 2 done — play it out to a champion.'; }
    else if (s1) { headline = 'Continue your prediction'; sub = 'Groups ranked — rank the 8 best third-place teams next.'; }
    else if (picks && picks.groups && Object.values(picks.groups).some((g) => g && g.some(Boolean))) {
      headline = 'Continue your prediction'; sub = "Pick up where you left off in the group stage.";
    }
  } catch {}
  wrap.innerHTML = `
    <div class="home-card pw-play-cta" data-testid="home-play-cta" style="border-left:4px solid var(--accent);">
      <h2 class="home-card-title">${escapeHtml(headline)}</h2>
      <p class="muted" style="margin:0 0 12px; font-size:13px;">${escapeHtml(sub)}</p>
      <button class="pick-btn" id="home-play-cta-btn" data-testid="home-play-cta-btn">Play →</button>
    </div>
  `;
  wrap.querySelector('#home-play-cta-btn').addEventListener('click', () => setRoute('play', { stage: '1' }));
  return wrap;
}

function renderQuickLinks() {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">Jump to</h2>
      <div class="home-grid">
        <button class="home-link" data-go="play"><span class="home-link-icon" aria-hidden="true">${icon('play')}</span><span>Play</span></button>
        <button class="home-link" data-go="matchups"><span class="home-link-icon" aria-hidden="true">${icon('ball')}</span><span>Matches</span></button>
        <button class="home-link" data-go="schedule"><span class="home-link-icon" aria-hidden="true">${icon('calendar')}</span><span>Schedule</span></button>
        <button class="home-link" data-go="venues"><span class="home-link-icon" aria-hidden="true">${icon('pin')}</span><span>Venues</span></button>
        <button class="home-link" data-go="groups"><span class="home-link-icon" aria-hidden="true">${icon('grid')}</span><span>Groups</span></button>
        <button class="home-link" data-go="brackets"><span class="home-link-icon" aria-hidden="true">${icon('bracket')}</span><span>Brackets</span></button>
        <button class="home-link" data-go="my-brackets"><span class="home-link-icon" aria-hidden="true">${icon('clipboard')}</span><span>My Brackets</span></button>
        <button class="home-link" data-go="hot-picks"><span class="home-link-icon" aria-hidden="true">${icon('flame')}</span><span>Hot Picks</span></button>
        <button class="home-link" data-go="golden-awards"><span class="home-link-icon" aria-hidden="true">${icon('trophy')}</span><span>Golden Awards</span></button>
        <button class="home-link" data-go="backtest"><span class="home-link-icon" aria-hidden="true">${icon('chart')}</span><span>Backtest</span></button>
        <button class="home-link" data-go="leaderboard"><span class="home-link-icon" aria-hidden="true">${icon('medal')}</span><span>Leaderboard</span></button>
        <button class="home-link" data-go="injuries"><span class="home-link-icon" aria-hidden="true">${icon('cross')}</span><span>Injuries</span></button>
      </div>
    </div>
  `;
  wrap.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (t) setRoute(t.dataset.go, {});
  });
  return wrap;
}

