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
import { renderGroupPickerView } from './views/group-picker-view.js';
import { initTeamSkin } from './team-skin.js';
import { showUpdateToastIfNew } from './update-toast.js';
import { renderSettingsView, initSettingsPrefs } from './views/settings-view.js';
import { renderInjuriesView } from './views/injuries-view.js';
import { renderSharedBracketView } from './views/shared-bracket-view.js';
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

const TITLES = {
  home: 'WC26',
  matchups: 'Matches',
  matchup: 'Matchup',
  groups: 'Groups',
  group: 'Group',
  bracket: 'Bracket',
  brackets: 'Brackets',
  'my-brackets': 'My Brackets',
  'create-group': 'New Pool',
  pools: 'Pools',
  'group-picks': 'Group Picks',
  injuries: 'Injuries',
  shared: 'Shared bracket',
  picks: 'My Picks',
  settings: 'Settings',
  team: 'Team',
  schedule: 'Schedule',
  venues: 'Venues',
  venue: 'Venue',
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
    matchups: 'matchups',
    schedule: 'schedule',
    venues: 'venues',
    venue: 'venues',
    groups: 'groups',
    group: 'groups',
    bracket: 'brackets',
    brackets: 'brackets',
    'my-brackets': 'my-brackets',
    'create-group': 'pools',
    pools: 'pools',
    'group-picks': 'group-picks',
    picks: 'picks',
    winner: 'matchups'
  };
  const activeTab = tabMap[view];
  for (const t of document.querySelectorAll('.tab-bar .tab')) {
    t.classList.toggle('is-active', t.dataset.route === activeTab);
  }

  // Update the text portion of the title only; the FIFA logo img sibling stays.
  const titleText = document.getElementById('app-title-text');
  if (titleText) titleText.textContent = TITLES[view] || 'WC26';

  switch (view) {
    case 'home':         renderHome(root, state.data, params); break;
    case 'matchups':     renderMatchupList(root, state.data, params); break;
    case 'matchup':      renderMatchupDetail(root, state.data, params); break;
    case 'groups':
    case 'group':        renderGroupView(root, state.data, params); break;
    case 'bracket':
    case 'brackets':     renderBracketsLiveView(root, state.data, params); break;
    case 'my-brackets':  renderMyBracketsView(root, state.data, params); break;
    case 'create-group': renderCreateGroupWizard(root, state.data, params); break;
    case 'pools':        renderPoolsView(root, state.data, params); break;
    case 'group-picks':  renderGroupPickerView(root, state.data, params); break;
    case 'settings':     renderSettingsView(root, state.data, params); break;
    case 'injuries':     renderInjuriesView(root, state.data, params); break;
    case 'shared':       renderSharedBracketView(root, state.data, params); break;
    case 'picks':        renderMyPicks(root, state.data, params); break;
    case 'team':         renderTeamDetail(root, state.data, params); break;
    case 'schedule':     renderScheduleView(root, state.data, params); break;
    case 'venues':       renderVenuesView(root, state.data, params); break;
    case 'venue':        renderVenueDetail(root, state.data, params); break;
    case 'winner':       renderWinnerView(root, state.data, params); break;
    default:             renderHome(root, state.data, params);
  }
  window.scrollTo(0, 0);
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
      if (r === 'home') setRoute('home', {});
      else if (r === 'matchups') setRoute('matchups', { group: grp });
      else if (r === 'schedule') setRoute('schedule', {});
      else if (r === 'venues') setRoute('venues', {});
      else if (r === 'groups') setRoute('group', { group: grp });
      else if (r === 'brackets') setRoute('brackets', {});
      else if (r === 'my-brackets') setRoute('my-brackets', {});
      else if (r === 'pools') setRoute('pools', {});
      else if (r === 'group-picks') setRoute('group-picks', {});
      else if (r === 'picks') setRoute('picks', {});
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
