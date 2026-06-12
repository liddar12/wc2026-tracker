/* live-poller.js — B1 + R22: live-window polling on two speeds.
   Every tick (30s): fetch ESPN's scoreboard DIRECTLY from the client and merge
   scores + game clock into the in-memory data (live-scores.js) — tiles show
   0-0 + LIVE within seconds of kickoff and goals within ~30s, with NO pipeline
   /deploy latency. Every 5th tick: full refreshData() so the rest of the feeds
   (odds, lineups, events) stay current too. Triggers 'data:live-refresh'. */

import { refreshData } from './data-loader.js';
import { fetchEspnLive, mergeLiveScores } from './live-scores.js';

const POLL_INTERVAL_MS = 30 * 1000;   // 30s during live windows
const FULL_REFRESH_EVERY = 5;         // full data refetch every 5th tick (2.5 min)
const LIVE_WINDOW_MS = 2 * 3600 * 1000;
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

async function pollOnce() {
  tickCount++;
  try {
    // Fast lane every tick: direct ESPN scoreboard → in-memory merge. Cheap
    // (~30KB) and instant — this is what makes scores + clock near-real-time.
    if (currentData) {
      try {
        const board = await fetchEspnLive();
        mergeLiveScores(currentData, board);
      } catch { /* ESPN blip — the pipeline copy still flows below */ }
    }
    // Slow lane every Nth tick: full static-feed refresh (odds, events, etc.).
    if (!currentData || tickCount % FULL_REFRESH_EVERY === 1) {
      const fresh = await refreshData();
      if (fresh) {
        // Re-apply the freshest live overlay on top of the just-fetched copy
        // so a stale deployed JSON can't visually regress a live score.
        try { mergeLiveScores(fresh, await fetchEspnLive()); } catch {}
        currentData = fresh;
      }
    }
    if (currentData) {
      window.dispatchEvent(new CustomEvent('data:live-refresh', { detail: { data: currentData } }));
    }
  } catch (e) {
    // Network blip — silently ignore; the next interval tick retries.
  }
}
