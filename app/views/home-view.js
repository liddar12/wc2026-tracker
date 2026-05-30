/* home-view.js — dashboard hub. Hero with countdown, last-updated stamp,
   today's matches, recent results, auth/group preview, Kalshi top movers,
   quick links to other tabs. */
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { formatLastUpdated } from '../data-loader.js';
import {
  getCompetitionState,
  isSupabaseConfigured,
  continueAsGuest,
  setAuthPanelMode,
  fetchLeaderboard
} from '../competition.js';

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
  if (!data) {
    const p = document.createElement('p');
    p.className = 'loading';
    p.textContent = 'Loading…';
    root.appendChild(p);
    return;
  }
  root.appendChild(renderHero(data));
  root.appendChild(renderAuthSlot(data));
  root.appendChild(renderTodaySection(data));
  const movers = renderMoversSection(data);
  if (movers) root.appendChild(movers);
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

  wrap.innerHTML = `
    <div class="home-hero-top">
      <div class="home-hero-eyebrow">FIFA World Cup 2026</div>
      <div class="home-hero-title">${escapeHtml(meta.dates || '11 June – 19 July 2026')}</div>
      <div class="home-hero-sub">${escapeHtml(meta.hosts?.join(' · ') || 'USA · Canada · Mexico')}</div>
    </div>
    ${openingDate ? renderCountdownShell(opening) : ''}
    <div class="home-hero-updated">
      <span class="home-hero-dot" aria-hidden="true"></span>
      Data updated <strong>${escapeHtml(formatLastUpdated(meta.data_version))}</strong>
      ${meta.data_version ? `<span class="muted"> · ${escapeHtml(meta.data_version.replace('T',' ').replace('+00:00','Z'))}</span>` : ''}
    </div>
  `;

  if (openingDate) {
    startCountdownTicker(wrap, openingDate);
  }
  return wrap;
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
      setAuthPanelMode('signin');
      setRoute('picks', {});
      return;
    }
    if (e.target.closest('[data-go-guest]')) {
      continueAsGuest();
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
  ol.innerHTML = `
    <h2 class="home-card-title">Active group leaderboard</h2>
    <ol class="home-leaderboard">
      ${top.map((r, i) => `<li><span class="lb-rank">${i + 1}</span> <span class="lb-name">${escapeHtml(r.username)}</span> <span class="lb-score">${r.score} pts</span></li>`).join('')}
    </ol>
  `;
  wrap.appendChild(ol);
}

function renderTodaySection(data) {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  const todayIso = new Date().toISOString().slice(0, 10);
  const scheduleFull = data.scheduleFull || [];
  const todays = scheduleFull
    .filter((m) => (m.kickoff_utc || '').slice(0, 10) === todayIso)
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
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">${heading}</h2>
      <div class="home-match-list">
        ${upcoming.slice(0, 6).map((m) => homeMatchRow(m)).join('')}
      </div>
      <div class="home-card-cta">
        <button class="pick-btn pick-btn-secondary" data-go="schedule">Full schedule →</button>
      </div>
    </div>
  `;
  wrap.addEventListener('click', (e) => {
    const card = e.target.closest('[data-mid]');
    if (card) {
      const ta = card.dataset.teamA;
      const tb = card.dataset.teamB;
      if (ta && tb) location.hash = `#/matchup/team_a/${encodeURIComponent(ta)}/team_b/${encodeURIComponent(tb)}`;
      return;
    }
    const tgt = e.target.closest('[data-go]');
    if (tgt) setRoute(tgt.dataset.go, {});
  });
  return wrap;
}

function homeMatchRow(m) {
  const t = new Date(m.kickoff_utc);
  const time = isNaN(t) ? 'TBA' : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isPlaceholder = typeof m.team_a === 'string' && /^[A-L]\d|\dW|\dL|W\d|L\d|^3\s|^\dW|^\dL|^1[A-L]|^2[A-L]|^3 /.test(m.team_a);
  const fa = isPlaceholder ? '·' : flagFor(m.team_a);
  const fb = isPlaceholder ? '·' : flagFor(m.team_b);
  const clickable = !isPlaceholder;
  return `
    <div class="home-match-row" ${clickable ? `data-mid="${escapeHtml(m.match_id)}" data-team-a="${escapeHtml(m.team_a)}" data-team-b="${escapeHtml(m.team_b)}" tabindex="0" role="button"` : ''}>
      <div class="hmr-time">${escapeHtml(time)}</div>
      <div class="hmr-teams">${fa} <strong>${escapeHtml(m.team_a)}</strong> vs <strong>${escapeHtml(m.team_b)}</strong> ${fb}</div>
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

function renderQuickLinks() {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">Jump to</h2>
      <div class="home-grid">
        <button class="home-link" data-go="matchups"><span class="home-link-emoji" aria-hidden="true">⚽</span><span>Matches</span></button>
        <button class="home-link" data-go="schedule"><span class="home-link-emoji" aria-hidden="true">📅</span><span>Schedule</span></button>
        <button class="home-link" data-go="venues"><span class="home-link-emoji" aria-hidden="true">📍</span><span>Venues</span></button>
        <button class="home-link" data-go="groups"><span class="home-link-emoji" aria-hidden="true">🅰️</span><span>Groups</span></button>
        <button class="home-link" data-go="brackets"><span class="home-link-emoji" aria-hidden="true">🏆</span><span>Brackets</span></button>
        <button class="home-link" data-go="my-brackets"><span class="home-link-emoji" aria-hidden="true">📝</span><span>My Brackets</span></button>
      </div>
    </div>
  `;
  wrap.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (t) setRoute(t.dataset.go, {});
  });
  return wrap;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
