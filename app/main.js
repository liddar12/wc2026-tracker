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
import { viewSkeleton } from './components/skeleton.js';
import { openSearch } from './components/search-overlay.js';
import { initPullToRefresh, pulseFooterUpdated } from './pull-to-refresh.js';
import { initCompetition, getCompetitionState } from './competition.js';
import { extractJoinCodeFromPath } from './competition-rules.js';

const TITLES = {
  home: 'WC26',
  matchups: 'Matches',
  matchup: 'Matchup',
  groups: 'Groups',
  group: 'Group',
  bracket: 'Bracket',
  brackets: 'Brackets',
  'my-brackets': 'My Brackets',
  'create-group': 'New Group',
  picks: 'My Picks',
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
  const showBack = ['matchup', 'team', 'group', 'venue', 'winner', 'create-group'].includes(view);
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
    'create-group': 'my-brackets',
    picks: 'picks',
    winner: 'matchups'
  };
  const activeTab = tabMap[view];
  for (const t of document.querySelectorAll('.tab-bar .tab')) {
    t.classList.toggle('is-active', t.dataset.route === activeTab);
  }

  document.getElementById('app-title').textContent = TITLES[view] || 'WC26';

  switch (view) {
    case 'home':         renderHome(root, state.data, params); break;
    case 'matchups':     renderMatchupList(root, state.data, params); break;
    case 'matchup':      renderMatchupDetail(root, state.data, params); break;
    case 'groups':
    case 'group':        renderGroupView(root, state.data, params); break;
    case 'bracket':      renderBracketView(root, state.data, params); break;
    case 'brackets':     renderBracketsLiveView(root, state.data, params); break;
    case 'my-brackets':  renderMyBracketsView(root, state.data, params); break;
    case 'create-group': renderCreateGroupWizard(root, state.data, params); break;
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
      if (r === 'home') setRoute('home', {});
      else if (r === 'matchups') setRoute('matchups', { group: 'D' });
      else if (r === 'schedule') setRoute('schedule', {});
      else if (r === 'venues') setRoute('venues', {});
      else if (r === 'groups') setRoute('group', { group: 'D' });
      else if (r === 'brackets') setRoute('brackets', {});
      else if (r === 'my-brackets') setRoute('my-brackets', {});
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
initPullToRefresh(pulseFooterUpdated);

const initial = parseHash(location.hash);
// Default to home when no specific route requested
if (!location.hash || location.hash === '#' || location.hash === '#/') {
  initial.view = 'home';
  initial.params = {};
} else if (initial.view === 'matchups' && !initial.params.group && !initial.params.watchlist) {
  initial.params.group = 'D';
}
getState().route = initial;

function shouldOpenPicksForJoin() {
  const comp = getCompetitionState();
  if (comp.activeCode || comp.invalidJoinCode) return true;
  return Boolean(extractJoinCodeFromPath(location.pathname));
}

loadData()
  .then(async (data) => {
    setData(data);
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
