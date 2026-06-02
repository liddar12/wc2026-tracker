/* main.js — entry point, router, view loop. */
import { loadData, formatLastUpdated } from './data-loader.js';
import { getState, setData, setRoute, parseHash } from './state.js';
import { initTheme } from './theme.js';
import { renderMatchupList } from './views/matchup-list.js';
import { renderMatchupDetail } from './views/matchup-detail.js';
import { renderGroupView } from './views/group-view.js';
import { renderBracketView } from './views/bracket-view.js';
import { renderBracketsLiveView } from './views/brackets-live-view.js';
import { renderMyBracketsView } from './views/my-brackets-view.js';
import { renderMyPicks } from './views/my-picks.js';
import { renderTeamDetail } from './views/team-detail.js';
import { renderScheduleView } from './views/schedule-view.js';
import { renderVenuesView } from './views/venues-view.js';
import { renderVenueDetail } from './views/venue-detail.js';
import { renderWinnerView } from './views/winner-view.js';
import { renderHome } from './views/home-view.js';
import { renderCreateGroupWizard } from './views/create-group-wizard.js';
import { renderPoolsView } from './views/pools-view.js';
// R6: standalone Group Picks retired — its logic now lives in Play Stage 1 + 2.
// import { renderGroupPickerView } from './views/group-picker-view.js';
import { initTeamSkin } from './team-skin.js';
import { showUpdateToastIfNew } from './update-toast.js';
import { renderSettingsView, initSettingsPrefs } from './views/settings-view.js';
import { renderInjuriesView } from './views/injuries-view.js';
import { renderSharedBracketView } from './views/shared-bracket-view.js';
import { renderHotPicksView } from './views/hot-picks-view.js';
import { renderBacktestView } from './views/backtest-view.js';
import { renderAccuracyScoreboardView } from './views/accuracy-scoreboard-view.js';
import { maybeShowInstallPrompt } from './install-prompt.js';
import { initCountdownBadge } from './countdown-badge.js';
import { showConfetti } from './confetti.js';
import { startLivePollerForData } from './live-poller.js';
import { viewSkeleton } from './components/skeleton.js';
import { openSearch } from './components/search-overlay.js';
import { initPullToRefresh, pulseFooterUpdated } from './pull-to-refresh.js';
import { initCompetition, getCompetitionState } from './competition.js';
import { extractJoinCodeFromPath } from './competition-rules.js';
import { defaultGroup } from './favorites.js';
import { initToolbarAuth } from './toolbar-auth.js';

const TITLES = {
  home: 'WC26',
  play: 'Play',
  bracket: 'Bracket',
  pools: 'Pools',
  'my-brackets': 'My Brackets',
  'my-picks': 'My Picks',
  schedule: 'Schedule',
  venues: 'Venues',
  venue: 'Venue',
  matches: 'Matches',
  matchups: 'Matches',  // legacy alias kept routable
  matchup: 'Matchup',
  group: 'Group',
  team: 'Team',
  settings: 'Settings',
  'create-group': 'New Pool',
  shared: 'Shared bracket',
  'hot-picks': 'Hot Picks',
  backtest: 'Backtest',
  leaderboard: 'Leaderboard',
  injuries: 'Injuries',
  winner: 'Winner Odds'
};

function renderView() {
  const state = getState();
  const root = document.getElementById('view');
  if (!state.data) {
    root.innerHTML = '';
    root.appendChild(viewSkeleton());
    return;
  }
  root.innerHTML = '';
  const { view, params } = state.route;

  const backBtn = document.getElementById('back-btn');
  const showBack = ['matchup', 'team', 'group', 'venue', 'winner', 'create-group', 'settings'].includes(view);
  backBtn.hidden = !showBack;

  const tabMap = {
    home: 'home',
    play: 'play',
    bracket: 'bracket',
    brackets: 'bracket',         // legacy alias
    pools: 'pools',
    'create-group': 'pools',
    'my-brackets': 'my-brackets',
    'my-picks': 'my-picks',
    picks: 'my-picks',           // legacy alias for old wc26.picks pickers
    matches: 'matches',
    matchups: 'matches',
    schedule: 'schedule',
    venues: 'venues',
    venue: 'venues',
    group: 'play',               // legacy group view nav-highlights Play
    groups: 'play',
    'group-picks': 'play',       // retired Group Picks tab now lives inside Play
    picks: 'picks',
    winner: 'matchups'
  };
  const activeTab = tabMap[view];
  for (const t of document.querySelectorAll('.tab-bar .tab')) {
    const isActive = t.dataset.route === activeTab;
    t.classList.toggle('is-active', isActive);
    if (isActive) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  // Update the text portion of the title only; the FIFA logo img sibling stays.
  const titleText = document.getElementById('app-title-text');
  if (titleText) titleText.textContent = TITLES[view] || 'WC26';

  switch (view) {
    case 'home':         renderHome(root, state.data, params); break;
    // R6 primary nav
    case 'play':         renderPlayShim(root, state.data, params); break;
    case 'bracket':
    case 'brackets':     renderBracketShim(root, state.data, params); break;
    case 'pools':        renderPoolsView(root, state.data, params); break;
    case 'my-brackets':  renderMyBracketsView(root, state.data, params); break;
    case 'my-picks':     renderMyPicks(root, state.data, params); break;
    case 'matches':
    case 'matchups':     renderMatchupList(root, state.data, params); break;
    case 'matchup':      renderMatchupDetail(root, state.data, params); break;
    case 'schedule':     renderScheduleView(root, state.data, params); break;
    case 'venues':       renderVenuesView(root, state.data, params); break;
    case 'venue':        renderVenueDetail(root, state.data, params); break;
    // R6: standalone Group Picks retired — redirect to Play
    case 'group-picks':  redirectToPlay(); break;
    // Detail/utility views (kept)
    case 'group':
    case 'groups':       renderGroupView(root, state.data, params); break;
    case 'team':         renderTeamDetail(root, state.data, params); break;
    case 'create-group': renderCreateGroupWizard(root, state.data, params); break;
    case 'settings':     renderSettingsView(root, state.data, params); break;
    case 'injuries':     renderInjuriesView(root, state.data, params); break;
    case 'shared':       renderSharedBracketView(root, state.data, params); break;
    case 'hot-picks':    renderHotPicksView(root, state.data, params); break;
    case 'backtest':     renderBacktestView(root, state.data, params); break;
    case 'leaderboard':  renderAccuracyScoreboardView(root, state.data, params); break;
    case 'picks':        renderMyPicks(root, state.data, params); break;  // legacy alias
    case 'winner':       renderWinnerView(root, state.data, params); break;
    default:             renderHome(root, state.data, params);
  }
  window.scrollTo(0, 0);
}

// R6 stubs — full views ship in T2 and T3.
async function renderPlayShim(root, data, params) {
  const m = await import('./views/play-view.js').catch(() => null);
  if (m?.renderPlayView) return m.renderPlayView(root, data, params);
  root.innerHTML = `<div class="home-card"><h2 class="home-card-title">Play</h2><p class="muted">Funnel loading…</p></div>`;
}
async function renderBracketShim(root, data, params) {
  const m = await import('./views/bracket-view-r6.js').catch(() => null);
  if (m?.renderBracketView) return m.renderBracketView(root, data, params);
  // Fallback to the legacy live view while the consolidated view is being wired.
  renderBracketsLiveView(root, data, params);
}
function redirectToPlay() {
  setRoute('play', { stage: '1' });
}

function updateFooter() {
  const state = getState();
  const el = document.getElementById('data-version');
  if (!el || !state.data?.meta) return;
  el.textContent = `Updated ${formatLastUpdated(state.data.meta.data_version)}`;
}

function bindNav() {
  document.getElementById('back-btn').addEventListener('click', () => {
    history.back();
  });
  document.getElementById('search-btn').addEventListener('click', () => {
    const state = getState();
    if (state.data) openSearch(state.data);
  });
  for (const tab of document.querySelectorAll('.tab-bar .tab')) {
    tab.addEventListener('click', () => {
      const r = tab.dataset.route;
      const data = getState().data;
      const grp = defaultGroup(data);
      switch (r) {
        case 'home':        return setRoute('home', {});
        case 'play':        return setRoute('play', {});
        case 'bracket':     return setRoute('bracket', {});
        case 'pools':       return setRoute('pools', {});
        case 'my-brackets': return setRoute('my-brackets', {});
        case 'my-picks':    return setRoute('my-picks', {});
        case 'matches':     return setRoute('matches', { group: grp });
        case 'schedule':    return setRoute('schedule', {});
        case 'venues':      return setRoute('venues', {});
        default:            return setRoute('home', {});
      }
    });
  }
}

window.addEventListener('hashchange', () => {
  const route = parseHash(location.hash);
  setRoute(route.view, route.params);
});

window.addEventListener('state:change', () => {
  renderView();
  updateFooter();
});

initTheme(document.getElementById('theme-btn'));
bindNav();
initTeamSkin();
// B1: when the live poller pushes fresh data, replace state.data so the
// current view re-renders with updated scores.
window.addEventListener('data:live-refresh', (e) => {
  const fresh = e.detail?.data;
  if (fresh) setData(fresh);
});
initSettingsPrefs();
initCountdownBadge({ title: 'WC26 Tracker' });
// Wire the gear icon in the header to navigate to /#/settings
document.getElementById('settings-btn')?.addEventListener('click', () => setRoute('settings', {}));
initPullToRefresh(pulseFooterUpdated);
initTabBarScrollHints();

function initTabBarScrollHints() {
  const wrap = document.getElementById('tab-bar-wrap');
  const bar = document.getElementById('tab-bar');
  if (!wrap || !bar) return;
  const update = () => {
    const left = bar.scrollLeft;
    const max = bar.scrollWidth - bar.clientWidth;
    wrap.classList.toggle('has-overflow-left', left > 4);
    wrap.classList.toggle('has-overflow-right', left < max - 4);
  };
  update();
  bar.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // Re-check after the initial DOM settles (font load, etc.).
  requestAnimationFrame(update);
  setTimeout(update, 250);
}

const initial = parseHash(location.hash);
// Default to home when no specific route requested
if (!location.hash || location.hash === '#' || location.hash === '#/') {
  initial.view = 'home';
  initial.params = {};
} else if (initial.view === 'matchups' && !initial.params.group && !initial.params.watchlist) {
  // Use favorite team's group as the default landing group when set; data may
  // not be loaded yet on first run, so fall back to 'D'.
  initial.params.group = defaultGroup(getState().data) || 'D';
}
getState().route = initial;

// Re-render the current view whenever the favorite changes — keeps Matches /
// Groups defaulting tabs in sync without a manual reload.
window.addEventListener('favorite:change', () => {
  const state = getState();
  if (!state.data) return;
  // If we're sitting on a default-group view, swap the group to the new favorite.
  if (state.route.view === 'matchups' && state.route.params.group) {
    setRoute('matchups', { group: defaultGroup(state.data) });
  } else if ((state.route.view === 'group' || state.route.view === 'groups') && state.route.params.group) {
    setRoute('group', { group: defaultGroup(state.data) });
  } else {
    // Otherwise just repaint so the home picker reflects the new value.
    window.dispatchEvent(new CustomEvent('state:change'));
  }
});

function shouldOpenPicksForJoin() {
  const comp = getCompetitionState();
  if (comp.activeCode || comp.invalidJoinCode) return true;
  return Boolean(extractJoinCodeFromPath(location.pathname));
}

loadData()
  .then(async (data) => {
    setData(data);
    initToolbarAuth(data);
    // Toast user when data is newer than their last visit (A11 enhanced
    // version computes a meaningful diff below).
    showUpdateToastIfNew(data);
    // A7: nudge iOS Safari visitors to add to home screen (gated to once
    // every 14 days; only iOS Safari; skipped if already standalone).
    setTimeout(() => maybeShowInstallPrompt(), 2500);
    // B1: kick off the live-score poller if we're in / near a match window.
    startLivePollerForData(data);
    await initCompetition(data);
    if (shouldOpenPicksForJoin()) {
      setRoute('picks', {});
      return;
    }
    const synced = parseHash(location.hash);
    const current = getState().route;
    if (
      current.view !== synced.view ||
      JSON.stringify(current.params || {}) !== JSON.stringify(synced.params || {})
    ) {
      setRoute(synced.view, synced.params);
    }
  })
  .catch((err) => {
    const root = document.getElementById('view');
    root.innerHTML = `<p class="loading">Failed to load data. <br><span class="muted">${escapeHtml(err.message)}</span></p>`;
  });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
