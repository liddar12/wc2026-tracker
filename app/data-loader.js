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
 *     h2h, form, scorers, weather, fatigue, xg, markets, injuries,
 *     consensusOdds, previews
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
  // Epic-A contract: knockout-stage match rows (mirror group_matchups rows +
  // advance_pct_a/b, is_knockout, stage, match_id, kickoff_utc). An ARRAY like
  // venues/schedule_full — default [] so knockout-aware views (home MOTD, etc.)
  // degrade to "none yet" rather than crashing before the bracket exists.
  { file: 'knockout_matchups.json', fallback: [] },
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
  { file: 'injuries.json',       fallback: {} },
  // Multi-book consensus odds (API-Football) — sharpens the Parlay of the Day's
  // market term; empty match_outcomes until the APIFOOTBALL_KEY cron runs.
  { file: 'consensus_odds.json', fallback: {} },
  // R16: DT Model site contract — team_rankings + title odds + players.
  { file: 'dt_model.json',       fallback: {} },
  // Hybrid forecast (⅓ J5L + ⅓ DT + ⅓ Kalshi): per-team round-reach + champion odds.
  { file: 'forecast.json',       fallback: {} },
  // Team kit colors (was only fetched ad-hoc by team-skin.js — loading it here
  // gives the freshness popover a real timestamp instead of "never").
  { file: 'team_colors.json',    fallback: {} },
  // Per-match goals + cards timeline (ESPN summary keyEvents).
  { file: 'match_events.json',   fallback: {} },
  // RJ30.2 Match Intelligence: per-fixture ESPN boxscore stats + key_events,
  // keyed by `${team_a}__vs__${team_b}`. Ships with a handful of real matches;
  // the match-stats / momentum components render nothing for pairs with no row.
  // NORMALIZED post-load (see normalizeMatchStats) so match-stats.js reads flat
  // stats_a / stats_b regardless of the on-disk nested `stats:{a,b}` shape.
  { file: 'match_stats.json',    fallback: {} },
  // Polymarket per-match outcome odds — overlaid UNDER Kalshi in the matchup
  // market bar (see app/markets.js mergedMarkets). In-play, so force-fetched
  // below (never served stale). Empty match_outcomes until the cron runs.
  { file: 'polymarket_odds.json', fallback: {} },
  // Committed steady-state pipeline health (validate report + feed freshness)
  // surfaced on the Status view.
  { file: 'pipeline_status.json', fallback: {} },
  // RJ30.1-D: AI match previews/recaps. Ships DORMANT — the empty stub keeps
  // the loader fetch a 200; entries only appear once the ANTHROPIC_API_KEY repo
  // secret is set and generate_previews.py runs in the cron.
  { file: 'previews.json',       fallback: {} }
];

const LS_VERSION_KEY = 'wc26.last_data_version';
const LS_DATA_PREFIX = 'wc26.data.';

// In-play feeds that must never be served stale from localStorage — always
// re-fetch even when meta.data_version is unchanged. markets.json (Kalshi) was
// already forced; polymarket_odds.json (live per-match odds) joins it so the
// matchup market bar reflects current prices, not a cached snapshot.
const FORCE_FETCH_FILES = new Set(['markets.json', 'polymarket_odds.json']);

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

  // Track which optional feeds fell back to their hard-coded default (file
  // genuinely absent / unfetchable + no cache) vs. loaded a real payload that
  // happens to be empty. Both still surface the same `fallback` VALUE to keep
  // existing consumers untouched; the marker just lets a caller (e.g. a
  // knockout-aware view) tell "no bracket file yet" from "bracket file is []".
  const fellBack = {};
  for (const { file, fallback } of OPTIONAL_FILES) {
    let json = (isFresh && !FORCE_FETCH_FILES.has(file)) ? readCache(file) : null;
    if (!json || forceRefresh) {
      try {
        json = await fetchJson(file);
        writeCache(file, json);
      } catch {
        json = readCache(file);
        if (!json) { json = fallback; fellBack[fileToKey(file)] = true; }
      }
    }
    out[fileToKey(file)] = json;
  }
  // RJ30.2: reconcile the on-disk match_stats.json shape to the component
  // contract. scrape_match_stats.py writes each row as { team_a, team_b,
  // stats:{a,b}, key_events, updated_at } with ESPN metric names
  // (possessionPct, foulsCommitted, effectiveTackles, totalCrosses, …); the
  // render components (app/components/match-stats.js) read FLAT stats_a/stats_b
  // with short keys (possession, fouls, tackles, crosses, …). Normalize in the
  // loader so the components stay untouched and render the REAL file.
  out.matchStats = normalizeMatchStats(out.matchStats);

  // Non-enumerable so it never shows up in JSON.stringify / Object.keys passes
  // that walk `out` as data — opt-in lookup only.
  Object.defineProperty(out, '__optionalFallbacks__', {
    value: fellBack, enumerable: false, configurable: true,
  });

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
    case 'knockout_matchups.json': return 'knockoutMatchups';
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
    case 'consensus_odds.json':  return 'consensusOdds';
    case 'dt_model.json':        return 'dtModel';
    case 'forecast.json':        return 'forecast';
    case 'team_colors.json':     return 'teamColors';
    case 'match_events.json':    return 'matchEvents';
    case 'match_stats.json':     return 'matchStats';
    case 'polymarket_odds.json': return 'polymarketOdds';
    case 'pipeline_status.json': return 'pipelineStatus';
    case 'previews.json':        return 'previews';
    default: return file.replace('.json', '');
  }
}

/* RJ30.2: map ESPN boxscore metric names (as written by scrape_match_stats.py
 * into the nested stats.{a,b}) onto the short keys the render components read.
 * Any already-short key (from a hand-authored / flat row or a test fixture) is
 * passed through untouched, so both shapes work. */
const MATCH_STATS_KEY_MAP = {
  possessionPct: 'possession',
  totalShots: 'totalShots',
  shotsOnTarget: 'shotsOnTarget',
  blockedShots: 'blockedShots',
  passPct: 'passPct',
  accuratePasses: 'accuratePasses',
  totalPasses: 'totalPasses',
  saves: 'saves',
  effectiveTackles: 'tackles',
  foulsCommitted: 'fouls',
  offsides: 'offsides',
  totalCrosses: 'crosses',
  wonCorners: 'corners',
};

/** Translate one side's stat object from ESPN metric names → component keys. */
function normalizeStatSide(side) {
  if (!side || typeof side !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(side)) {
    const mapped = MATCH_STATS_KEY_MAP[k];
    // Keep the mapped short key; also preserve any key that is already short
    // (i.e. is itself a target name) so pre-normalized fixtures pass through.
    if (mapped) out[mapped] = v;
    else out[k] = v;
  }
  return out;
}

/**
 * Reconcile match_stats.json to the render contract. Given the loaded object
 * (keyed by `${team_a}__vs__${team_b}`, plus an optional `__meta__` row), add
 * a flat `stats_a` / `stats_b` to every fixture row from its nested `stats.a` /
 * `stats.b` (or leave existing flat fields as-is), keeping the original nested
 * `stats`, `key_events`, and `updated_at` intact. Returns a NEW object; the
 * `__meta__` row and non-object entries are passed through unchanged. Never
 * throws — a malformed row degrades to empty sides.
 */
export function normalizeMatchStats(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, row] of Object.entries(raw)) {
    if (key === '__meta__' || !row || typeof row !== 'object') {
      out[key] = row;
      continue;
    }
    const nested = row.stats && typeof row.stats === 'object' ? row.stats : null;
    // Prefer an already-flat stats_a/stats_b (test fixtures / hand-authored);
    // otherwise derive it from the nested ESPN shape.
    const stats_a = row.stats_a ? normalizeStatSide(row.stats_a)
      : nested ? normalizeStatSide(nested.a) : {};
    const stats_b = row.stats_b ? normalizeStatSide(row.stats_b)
      : nested ? normalizeStatSide(nested.b) : {};
    out[key] = { ...row, stats_a, stats_b };
  }
  return out;
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
