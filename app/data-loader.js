/* data-loader.js
 * Fetches the static JSON data files, caches in localStorage, and re-fetches
 * only when meta.json's data_version is newer than what's cached.
 *
 * First-load performance: files are split into a CRITICAL set (the ~10 feeds
 * needed to render home/schedule/matchup/standings/bracket) and a DEFERRED set
 * (everything else — players, market/live/intel feeds). loadData() fetches ONLY
 * the CRITICAL set (in parallel) and resolves fast so the app paints; every
 * deferred key is present in that result as its graceful fallback ([] or {}).
 * loadDeferred() then fetches the DEFERRED set in parallel in the background and
 * merges it over the critical result. Every phase is a Promise.all — never a
 * sequential await over the file list.
 *
 * Both sets keep the same graceful-fallback semantics as before: default to {}
 * (or [] for list feeds) when a file is missing/empty so the UI degrades rather
 * than crashing.
 *
 * Public:
 *   loadData() -> critical data (fast) with deferred keys as fallbacks
 *   loadDeferred(baseData, forceRefresh=false) -> { ...baseData, ...deferred }
 *   refreshData() -> full data (critical + deferred, force-refreshed)
 *   { ...meta, teams, players, groupMatchups, schedule, actualResults,
 *     venues, scheduleFull, knockoutMatchups, forecast, dtModel, lineups,
 *     referees, matchReferees, h2h, form, scorers, weather, fatigue, xg,
 *     markets, injuries, consensusOdds, teamColors, matchEvents, matchStats,
 *     polymarketOdds, pipelineStatus, previews }
 */

// CRITICAL: fetched first, in parallel; loadData() resolves once these land and
// the app renders home/schedule/matchup/standings/bracket from them. meta.json
// leads (its data_version drives the cache-freshness short-circuit) but is
// fetched with the same helper as the rest. List feeds default to []; the map
// feeds default to {}.
const CRITICAL_FILES = [
  { file: 'meta.json',              fallback: {} },
  { file: 'teams.json',             fallback: {} },
  { file: 'group_matchups.json',    fallback: [] },
  { file: 'schedule.json',          fallback: [] },
  { file: 'actual_results.json',    fallback: [] },
  { file: 'venues.json',            fallback: [] },
  { file: 'schedule_full.json',     fallback: [] },
  // Epic-A contract: knockout-stage match rows (mirror group_matchups rows +
  // advance_pct_a/b, is_knockout, stage, match_id, kickoff_utc). An ARRAY like
  // venues/schedule_full — default [] so knockout-aware views (home MOTD, etc.)
  // degrade to "none yet" rather than crashing before the bracket exists.
  { file: 'knockout_matchups.json', fallback: [] },
  // Hybrid forecast (⅓ J5L + ⅓ DT + ⅓ Kalshi): per-team round-reach + champion
  // odds — drives the bracket / standings advance %s, so critical.
  { file: 'forecast.json',          fallback: {} },
  // R16: DT Model site contract — team_rankings + title odds + players.
  { file: 'dt_model.json',          fallback: {} },
];

// DEFERRED: fetched in the BACKGROUND after first paint, in parallel. Until
// loadDeferred() lands, each of these keys is present in the critical result as
// its fallback below so components render "empty" gracefully. players.json moved
// REQUIRED→deferred (363 KB; golden-boot/awards already degrade on []) so its
// fallback is [] (a player list) and it no longer throws if missing.
const DEFERRED_FILES = [
  { file: 'players.json',        fallback: [] },
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

// ---------------------------------------------------------------------------
// Load-behavior classification (orthogonal to the critical/deferred SCHEDULE
// above). REQUIRED_FILES are the only feeds that THROW when they can't be
// fetched AND aren't cached — a real boot is meaningless without them. Every
// other feed is OPTIONAL: a miss degrades to its fallback ([] or {}) and the UI
// renders "empty" rather than crashing. This split is what makes a feed safe to
// DEFER — an optional feed is safe to stream in behind first paint. players.json
// moved out of REQUIRED (it's deferred now), so it no longer throws if missing.
// ---------------------------------------------------------------------------
const REQUIRED_FILES = [
  { file: 'meta.json',  fallback: {} },
  { file: 'teams.json', fallback: {} },
];

// Every graceful feed — both the critical-but-graceful ones (venues,
// schedule_full, knockout_matchups, forecast, dt_model, group_matchups,
// schedule, actual_results) and the deferred ones. Membership here means "never
// throws"; the critical/deferred arrays above decide WHEN each is fetched. Kept
// as an explicit literal (not `...DEFERRED_FILES`) so it reads as one flat
// classification of every optional feed.
const OPTIONAL_FILES = [
  { file: 'group_matchups.json',    fallback: [] },
  { file: 'schedule.json',          fallback: [] },
  { file: 'actual_results.json',    fallback: [] },
  { file: 'venues.json',            fallback: [] },
  { file: 'schedule_full.json',     fallback: [] },
  { file: 'knockout_matchups.json', fallback: [] },
  { file: 'forecast.json',          fallback: {} },
  { file: 'dt_model.json',          fallback: {} },
  { file: 'players.json',           fallback: [] },
  { file: 'lineups.json',           fallback: {} },
  { file: 'referees.json',          fallback: {} },
  { file: 'match_referees.json',    fallback: {} },
  { file: 'h2h.json',               fallback: {} },
  { file: 'form.json',              fallback: {} },
  { file: 'scorers.json',           fallback: {} },
  { file: 'weather.json',           fallback: {} },
  { file: 'fatigue.json',           fallback: {} },
  { file: 'xg.json',                fallback: {} },
  { file: 'markets.json',           fallback: {} },
  { file: 'injuries.json',          fallback: {} },
  { file: 'consensus_odds.json',    fallback: {} },
  { file: 'team_colors.json',       fallback: {} },
  { file: 'match_events.json',      fallback: {} },
  { file: 'match_stats.json',       fallback: {} },
  { file: 'polymarket_odds.json',   fallback: {} },
  { file: 'pipeline_status.json',   fallback: {} },
  { file: 'previews.json',          fallback: {} },
];
// Reference the classification arrays so they're never dead-code-eliminated by a
// future tidy — they document the throwing/graceful contract the loader honors.
void [REQUIRED_FILES, OPTIONAL_FILES];

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

/* Fetch ONE file, honoring the freshness cache + force-fetch rules. Returns
 * { key, json, fellBack } so callers can gather results with Promise.all. When
 * `required` and the file can't be fetched OR read from cache, throws (only the
 * two truly-load-bearing critical files — meta + teams — use this). Otherwise a
 * miss degrades to `fallback` and reports fellBack:true so a caller can tell
 * "file genuinely absent" from "file is legitimately empty". */
async function loadOne({ file, fallback }, { isFresh, forceRefresh, required = false }) {
  const key = fileToKey(file);
  const forceFetch = FORCE_FETCH_FILES.has(file);
  let json = (isFresh && !forceFetch && !forceRefresh) ? readCache(file) : null;
  if (!json) {
    try {
      json = await fetchJson(file);
      writeCache(file, json);
      return { key, json, fellBack: false };
    } catch (err) {
      json = readCache(file);
      if (!json) {
        if (required) throw err;
        return { key, json: fallback, fellBack: true };
      }
    }
  }
  return { key, json, fellBack: false };
}

// Non-enumerable marker: which feeds fell back to their hard-coded default (file
// genuinely absent / unfetchable + no cache) vs. loaded a real payload that
// happens to be empty. Both surface the same `fallback` VALUE to keep existing
// consumers untouched; the marker just lets a caller (e.g. a knockout-aware
// view) tell "no bracket file yet" from "bracket file is []". Non-enumerable so
// it never shows up in JSON.stringify / Object.keys passes — opt-in lookup only.
function defineFallbackMarker(out, fellBack) {
  Object.defineProperty(out, '__optionalFallbacks__', {
    value: fellBack, enumerable: false, configurable: true,
  });
  return out;
}

/* Fetch the CRITICAL set in parallel and resolve fast so the app can render.
 * meta.json leads (its data_version drives cache freshness), then the rest of
 * the critical files fetch together via Promise.all. Every DEFERRED key is
 * seeded into the result as its fallback so components render "empty" until
 * loadDeferred() lands. meta + teams are required (a real boot needs them); the
 * remaining critical feeds degrade gracefully like the deferred ones. */
async function loadCritical(forceRefresh = false) {
  // meta.json first — its data_version gates the freshness short-circuit for
  // every other file. Required: fall back to cache, else throw.
  const metaRes = await loadOne(
    CRITICAL_FILES[0],
    { isFresh: false, forceRefresh, required: true },
  );
  const meta = metaRes.json;

  const cachedVersion = localStorage.getItem(LS_VERSION_KEY);
  const isFresh = !forceRefresh && cachedVersion === meta.data_version;

  const out = { meta };
  const fellBack = {};

  // teams is required; the rest of the critical set degrades gracefully. Fetch
  // them all together — parallel, never a sequential await over the list.
  const rest = await Promise.all(
    CRITICAL_FILES.slice(1).map((spec) =>
      loadOne(spec, { isFresh, forceRefresh, required: spec.file === 'teams.json' })),
  );
  for (const { key, json, fellBack: fb } of rest) {
    out[key] = json;
    if (fb) fellBack[key] = true;
  }

  // Seed every DEFERRED key with its fallback so the first render never hits an
  // undefined feed. These are NOT marked fellBack — a not-yet-loaded deferred
  // key in the critical result is just its fallback, not an attempted+failed
  // fetch (loadDeferred sets the marker when it actually tries and fails).
  for (const { file, fallback } of DEFERRED_FILES) {
    out[fileToKey(file)] = fallback;
  }

  // match_stats seed is {} — normalize is a no-op on it now; loadDeferred
  // re-normalizes once the real file lands.
  out.matchStats = normalizeMatchStats(out.matchStats);

  defineFallbackMarker(out, fellBack);

  writeCache('meta.json', meta);
  localStorage.setItem(LS_VERSION_KEY, meta.data_version);
  return out;
}

/* Fetch the DEFERRED set in parallel and merge it OVER `baseData` (the critical
 * result). Returns a NEW object { ...baseData, ...deferred } with
 * normalizeMatchStats + the non-enumerable __optionalFallbacks__ marker applied
 * to the merged result (carrying over any critical fell-back keys). Called in
 * the background after first paint; never throws (a failed deferred feed
 * degrades to its fallback + is marked). */
export async function loadDeferred(baseData = {}, forceRefresh = false) {
  const cachedVersion = localStorage.getItem(LS_VERSION_KEY);
  const metaVersion = baseData?.meta?.data_version;
  const isFresh = !forceRefresh && metaVersion != null && cachedVersion === metaVersion;

  const results = await Promise.all(
    DEFERRED_FILES.map((spec) => loadOne(spec, { isFresh, forceRefresh })),
  );

  const out = { ...baseData };
  // Carry over any fell-back critical keys so the marker stays complete.
  const fellBack = { ...(baseData.__optionalFallbacks__ || {}) };
  for (const { key, json, fellBack: fb } of results) {
    out[key] = json;
    if (fb) fellBack[key] = true;
    else delete fellBack[key];
  }

  // RJ30.2: reconcile the on-disk match_stats.json shape to the component
  // contract. scrape_match_stats.py writes each row as { team_a, team_b,
  // stats:{a,b}, key_events, updated_at } with ESPN metric names
  // (possessionPct, foulsCommitted, effectiveTackles, totalCrosses, …); the
  // render components (app/components/match-stats.js) read FLAT stats_a/stats_b
  // with short keys (possession, fouls, tackles, crosses, …). Normalize in the
  // loader so the components stay untouched and render the REAL file.
  out.matchStats = normalizeMatchStats(out.matchStats);

  return defineFallbackMarker(out, fellBack);
}

/** Critical-path load: resolves after the CRITICAL set (fast). Deferred feeds
 *  are present as fallbacks; call loadDeferred(data) to stream the rest in. */
export async function loadData() {
  return loadCritical(false);
}

/** Force re-fetch (pull-to-refresh): full data (critical THEN deferred), always
 *  re-pulls markets.json + polymarket_odds.json. */
export async function refreshData() {
  localStorage.removeItem(LS_VERSION_KEY);
  const critical = await loadCritical(true);
  return loadDeferred(critical, true);
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
