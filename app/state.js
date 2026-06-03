/* state.js — central state store with localStorage persistence.
 *
 * Mutating helpers fire a `state:change` event on `window` for subscribers.
 */

const LS_PICKS = 'wc26.picks';
const LS_PREFS = 'wc26.prefs';
const LS_WATCHLIST = 'wc26.watchlist';

const state = {
  data: null,            // populated by data-loader
  route: { view: 'home', params: {} },
  picks: loadPicks(),
  prefs: loadPrefs()
};

function loadPicks() {
  try {
    const raw = localStorage.getItem(LS_PICKS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistPicks() {
  try { localStorage.setItem(LS_PICKS, JSON.stringify(state.picks)); } catch {}
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    return raw ? JSON.parse(raw) : { theme: 'auto', defaultGroup: 'D' };
  } catch {
    return { theme: 'auto', defaultGroup: 'D' };
  }
}

function persistPrefs() {
  try { localStorage.setItem(LS_PREFS, JSON.stringify(state.prefs)); } catch {}
}

function emit() {
  window.dispatchEvent(new CustomEvent('state:change'));
}

export function getState() { return state; }

export function setData(data) {
  state.data = data;
  emit();
}

export function setRoute(view, params = {}) {
  state.route = { view, params };
  // Sync to hash for back/forward navigation
  const hash = buildHash(view, params);
  if (location.hash !== hash) location.hash = hash;
  // Use the View Transitions API when available for smooth route-change
  // animations. Falls back to plain emit() if the browser doesn't support it.
  if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
      && !document.documentElement.classList.contains('wc-reduce-motion')) {
    document.startViewTransition(() => { emit(); });
  } else {
    emit();
  }
}

export function parseHash(hash) {
  const trimmed = (hash || '').replace(/^#\/?/, '');
  // R14: empty hash defaults to Home (the nav's first tab + the intended
  // landing), not the optional Matches view. Previously the app showed
  // Matches content while the nav highlighted Home — a confusing mismatch.
  if (!trimmed) return { view: 'home', params: {} };
  // R6 QA: support both path-style params (`#/bracket/mode/projected`)
  // and query-string params (`#/bracket?mode=projected&source=hybrid`).
  // Without this the router silently drops the query and lands on Home.
  const [base, query = ''] = trimmed.split('?');
  const [view, ...rest] = base.split('/');
  const params = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i]) params[rest[i]] = decodeURIComponent(rest[i + 1] || '');
  }
  if (query) {
    for (const pair of query.split('&')) {
      if (!pair) continue;
      const [k, v = ''] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { view: view || 'home', params };
}

function buildHash(view, params) {
  const parts = [view];
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    parts.push(k, encodeURIComponent(String(v)));
  }
  return '#/' + parts.join('/');
}

/* Picks */

export function makePickKey(match) {
  return `${match.team_a}__vs__${match.team_b}`;
}

export function setPick(match, choice) {
  const key = makePickKey(match);
  state.picks[key] = {
    team_a: match.team_a,
    team_b: match.team_b,
    choice,        // 'team_a' | 'draw' | 'team_b'
    model_pick: match.predicted_winner,
    model_confidence: match.win_confidence_pct,
    picked_at: new Date().toISOString()
  };
  persistPicks();
  if (window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('competition:picks-updated', { detail: { picks: state.picks } }));
  }
  emit();
}

export function getPick(match) {
  return state.picks[makePickKey(match)] || null;
}

export function clearPick(match) {
  delete state.picks[makePickKey(match)];
  persistPicks();
  if (window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('competition:picks-updated', { detail: { picks: state.picks } }));
  }
  emit();
}

export function allPicks() {
  return Object.entries(state.picks).map(([key, p]) => ({ key, ...p }));
}

export function replaceAllPicks(nextPicks) {
  state.picks = nextPicks && typeof nextPicks === 'object' ? nextPicks : {};
  persistPicks();
  emit();
}

/* Prefs */

export function setPref(key, value) {
  state.prefs[key] = value;
  persistPrefs();
  emit();
}

/* Watchlist */

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(LS_WATCHLIST);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistWatchlist(list) {
  try { localStorage.setItem(LS_WATCHLIST, JSON.stringify(list)); } catch {}
}

export function watchlistKeys() {
  return loadWatchlist();
}

export function isWatchlisted(match) {
  const key = makePickKey(match);
  return loadWatchlist().includes(key);
}

export function toggleWatchlist(match) {
  const key = makePickKey(match);
  let list = loadWatchlist();
  if (list.includes(key)) list = list.filter((k) => k !== key);
  else list = [...list, key];
  persistWatchlist(list);
  emit();
}
