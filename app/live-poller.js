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
// Resilience: after this many CONSECUTIVE failed ESPN fetches, stop hammering
// the endpoint every 30s (a sustained ESPN outage / offline device) and back
// off to a slower cadence, emitting a 'scores delayed' signal so the UI can
// say so. A single success resets both.
const FAILURES_BEFORE_BACKOFF = 3;
const BACKOFF_INTERVAL_MS = 2 * 60 * 1000;   // 2 min while degraded
// 3.5h (was 2h): a 90-min match + halftime + stoppage runs ~1h50m, and ESPN
// posts FULL_TIME a bit later — plus fans check the score well after the final
// whistle. The 2h window stopped polling before a just-finished game's final
// merged (France–Senegal: viewed 2h40m post-kickoff, still showed 0-0 because
// the throttled */15 cron hadn't committed and the client had stopped polling).
const LIVE_WINDOW_MS = 3.5 * 3600 * 1000;
let intervalId = null;
let currentData = null;
let tickCount = 0;
let consecutiveFailures = 0;   // resets to 0 on any successful ESPN fetch
let backoffActive = false;     // true while we're polling on the slow cadence

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
  consecutiveFailures = 0;
  backoffActive = false;
}

// Emit a 'scores delayed' signal so the UI can show a "scores may be delayed"
// hint (and clear it on recovery). `delayed` true = degraded (backoff engaged).
function emitScoresDelayed(delayed) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('data:scores-delayed', {
    detail: { delayed, consecutiveFailures },
  }));
}

// After repeated consecutive ESPN failures, slow the poll cadence so we stop
// hammering a dead endpoint every 30s. A later success calls resetBackoff().
function enterBackoff() {
  if (backoffActive) return;
  backoffActive = true;
  if (intervalId != null) clearInterval(intervalId);
  intervalId = setInterval(pollOnce, BACKOFF_INTERVAL_MS);
  emitScoresDelayed(true);
}

// Recovery: a successful fetch clears the failure streak and, if we were backed
// off, restores the fast 30s cadence and clears the 'delayed' signal.
function resetBackoff() {
  consecutiveFailures = 0;
  if (!backoffActive) return;
  backoffActive = false;
  if (intervalId != null) clearInterval(intervalId);
  intervalId = setInterval(pollOnce, POLL_INTERVAL_MS);
  emitScoresDelayed(false);
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
        // Success — clear any failure streak / backoff and the delayed signal.
        resetBackoff();
      } catch {
        // ESPN blip — the slow lane below still flows. Track the streak and, if
        // it's sustained, back off so we stop hammering every 30s.
        consecutiveFailures++;
        if (consecutiveFailures >= FAILURES_BEFORE_BACKOFF) enterBackoff();
      }
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
