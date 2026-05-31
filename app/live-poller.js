/* live-poller.js — B1: poll our static data feeds for fresh scores when
   there's a match in [now, now+2h]. Triggers a 'data:live-refresh' event
   on window when new data arrives so any view can re-render. */

import { refreshData } from './data-loader.js';

const POLL_INTERVAL_MS = 30 * 1000;   // 30s during live windows
const LIVE_WINDOW_MS = 2 * 3600 * 1000;
let intervalId = null;

export function startLivePollerForData(data) {
  stopLivePoller();
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
  // Re-fetch data; if it changed (data_version), the data-loader updates
  // the cache and we emit a refresh event. Always re-emit so views can
  // poll for the latest UTC moment regardless of data-version delta.
  try {
    const fresh = await refreshData();
    window.dispatchEvent(new CustomEvent('data:live-refresh', { detail: { data: fresh } }));
  } catch (e) {
    // Network blip — silently ignore; the next interval tick retries.
  }
}
