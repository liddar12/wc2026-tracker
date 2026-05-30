/* data-loader.js
 * Fetches the static JSON data files, caches in localStorage, and re-fetches
 * only when meta.json's data_version is newer than what's cached.
 *
 * Files are partitioned into REQUIRED (must load or we throw) and OPTIONAL
 * (Phase 2 additions; default to {} when missing/empty so the UI degrades
 * gracefully rather than crashing).
 *
 * Public:
 *   loadData() -> {
 *     meta, teams, players, groupMatchups, schedule, actualResults,
 *     venues, scheduleFull, lineups, referees, matchReferees,
 *     h2h, form, scorers, weather, fatigue, xg, markets, injuries
 *   }
 */

const REQUIRED_FILES = [
  'meta.json',
  'teams.json',
  'players.json',
  'group_matchups.json',
  'schedule.json',
  'actual_results.json'
];

// Phase 2: graceful fallback to {} (or [] for venues/schedule_full) when missing.
const OPTIONAL_FILES = [
  { file: 'venues.json',         fallback: [] },
  { file: 'schedule_full.json',  fallback: [] },
  { file: 'lineups.json',        fallback: {} },
  { file: 'referees.json',       fallback: {} },
  { file: 'match_referees.json', fallback: {} },
  { file: 'h2h.json',            fallback: {} },
  { file: 'form.json',           fallback: {} },
  { file: 'scorers.json',        fallback: {} },
  { file: 'weather.json',        fallback: {} },
  { file: 'fatigue.json',        fallback: {} },
  { file: 'xg.json',             fallback: {} },
  { file: 'markets.json',        fallback: {} },
  { file: 'injuries.json',       fallback: {} }
];

const LS_VERSION_KEY = 'wc26.last_data_version';
const LS_DATA_PREFIX = 'wc26.data.';

async function fetchJson(file) {
  const res = await fetch(`data/${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
  return res.json();
}

function readCache(file) {
  try {
    const raw = localStorage.getItem(LS_DATA_PREFIX + file);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(file, json) {
  try {
    localStorage.setItem(LS_DATA_PREFIX + file, JSON.stringify(json));
  } catch {
    // quota exceeded — silently skip; next fetch will re-pull
  }
}

async function loadAll(forceRefresh = false) {
  let meta;
  try {
    meta = await fetchJson('meta.json');
  } catch (err) {
    meta = readCache('meta.json');
    if (!meta) throw err;
  }

  const cachedVersion = localStorage.getItem(LS_VERSION_KEY);
  const isFresh = !forceRefresh && cachedVersion === meta.data_version;

  const out = { meta };

  for (const f of REQUIRED_FILES.slice(1)) {
    let json = isFresh ? readCache(f) : null;
    if (!json) {
      try {
        json = await fetchJson(f);
        writeCache(f, json);
      } catch (err) {
        json = readCache(f);
        if (!json) throw err;
      }
    }
    out[fileToKey(f)] = json;
  }

  for (const { file, fallback } of OPTIONAL_FILES) {
    let json = (isFresh && file !== 'markets.json') ? readCache(file) : null;
    if (!json || forceRefresh) {
      try {
        json = await fetchJson(file);
        writeCache(file, json);
      } catch {
        json = readCache(file);
        if (!json) json = fallback;
      }
    }
    out[fileToKey(file)] = json;
  }

  writeCache('meta.json', meta);
  localStorage.setItem(LS_VERSION_KEY, meta.data_version);
  return out;
}

export async function loadData() {
  return loadAll(false);
}

/** Force re-fetch (pull-to-refresh); always pulls markets.json. */
export async function refreshData() {
  localStorage.removeItem(LS_VERSION_KEY);
  return loadAll(true);
}

function fileToKey(file) {
  switch (file) {
    case 'teams.json':           return 'teams';
    case 'players.json':         return 'players';
    case 'group_matchups.json':  return 'groupMatchups';
    case 'schedule.json':        return 'schedule';
    case 'actual_results.json':  return 'actualResults';
    case 'venues.json':          return 'venues';
    case 'schedule_full.json':   return 'scheduleFull';
    case 'lineups.json':         return 'lineups';
    case 'referees.json':        return 'referees';
    case 'match_referees.json':  return 'matchReferees';
    case 'h2h.json':             return 'h2h';
    case 'form.json':            return 'form';
    case 'scorers.json':         return 'scorers';
    case 'weather.json':         return 'weather';
    case 'fatigue.json':         return 'fatigue';
    case 'xg.json':              return 'xg';
    case 'markets.json':         return 'markets';
    case 'injuries.json':        return 'injuries';
    default: return file.replace('.json', '');
  }
}

export function formatLastUpdated(isoString) {
  if (!isoString) return 'never';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
