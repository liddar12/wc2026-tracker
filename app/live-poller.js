/* live-poller.js — B1 + R22: live-window polling on two speeds.
   Every tick (30s): fetch ESPN's scoreboard DIRECTLY from the client and merge
   scores + game clock into the in-memory data (live-scores.js) — tiles show
   0-0 + LIVE within seconds of kickoff and goals within ~30s, with NO pipeline
   /deploy latency. Every 5th tick: full refreshData() so the rest of the feeds
   (odds, lineups, events) stay current too. Triggers 'data:live-refresh'. */

import { refreshData } from './data-loader.js';
import { fetchEspnLive, mergeLiveScores } from './live-scores.js';
import { fetchLiveOdds } from './live-odds.js';

const POLL_INTERVAL_MS = 30 * 1000;   // 30s during live windows
const FULL_REFRESH_EVERY = 5;         // full data refetch every 5th tick (2.5 min)
// 3.5h (was 2h): a 90-min match + halftime + stoppage runs ~1h50m, and ESPN
// posts FULL_TIME a bit later — plus fans check the score well after the final
// whistle. The 2h window stopped polling before a just-finished game's final
// merged (France–Senegal: viewed 2h40m post-kickoff, still showed 0-0 because
// the throttled */15 cron hadn't committed and the client had stopped polling).
const LIVE_WINDOW_MS = 3.5 * 3600 * 1000;
let intervalId = null;
let currentData = null;
let tickCount = 0;

export function startLivePollerForData(data) {
  stopLivePoller();
  currentData = data || null;
  if (!data?.scheduleFull) return;
  const liveStart = nearestLiveStart(data.scheduleFull);
  if (!liveStart) return;
  // Compute first delay: if we're already in a live window, poll now;
  // otherwise sleep until window starts.
  const sleepMs = Math.max(0, liveStart - Date.now());
  setTimeout(() => {
    pollOnce();
    intervalId = setInterval(pollOnce, POLL_INTERVAL_MS);
  }, sleepMs);
}

export function stopLivePoller() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function nearestLiveStart(scheduleFull) {
  // Returns the timestamp (ms) of the next match kickoff that's either
  // currently within the live window OR will start within 12 hours.
  const now = Date.now();
  let best = null;
  for (const m of scheduleFull) {
    const k = Date.parse(m.kickoff_utc || '');
    if (!Number.isFinite(k)) continue;
    if (k <= now && k + LIVE_WINDOW_MS > now) return now;  // in-progress now
    if (k > now && k - now < 12 * 3600 * 1000) {
      if (best === null || k < best) best = k;
    }
  }
  return best;
}

function emitLiveRefresh() {
  if (currentData) {
    window.dispatchEvent(new CustomEvent('data:live-refresh', { detail: { data: currentData } }));
  }
}

async function pollOnce() {
  tickCount++;
  try {
    // Fast lane every tick: direct ESPN scoreboard → in-memory merge, then
    // PAINT IMMEDIATELY. Score/clock freshness must NEVER wait on the slow lane
    // below — the durable actual_results.json ships matches as STATUS_SCHEDULED
    // stubs (rejected by actualForCard), so the live score exists only in this
    // merge. Gating the dispatch behind refreshData() + fetchLiveOdds() left a
    // freshly-opened view (e.g. a deep-linked match detail) showing "vs" for
    // ~7s on the one in-progress game. Cheap (~30KB) and near-instant.
    if (currentData) {
      try {
        const board = await fetchEspnLive();
        mergeLiveScores(currentData, board);
      } catch { /* ESPN blip — the slow lane below still flows */ }
      emitLiveRefresh();
    }
    // Slow lane every Nth tick: full static-feed refresh + near-real-time
    // betting lines (ESPN/DraftKings) for the Parlay of the Day. Repaints again
    // when done — but scores are already on screen from the fast lane above.
    if (!currentData || tickCount % FULL_REFRESH_EVERY === 1) {
      const fresh = await refreshData();
      if (fresh) {
        try { mergeLiveScores(fresh, await fetchEspnLive()); } catch {}
        try { fresh.liveOdds = await fetchLiveOdds(); } catch { fresh.liveOdds = currentData?.liveOdds; }
        currentData = fresh;
        emitLiveRefresh();
      }
    }
  } catch (e) {
    // Network blip — silently ignore; the next interval tick retries.
  }
}
