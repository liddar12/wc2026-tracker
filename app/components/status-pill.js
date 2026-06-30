/* status-pill.js — small badge for a bracket/match row.
   States: scheduled (kickoff time), LIVE (currently playing), FT (final),
   PEN (penalty-shootout result), TBD (no kickoff yet). */

import { FINAL_STATUSES, LIVE_STATUSES } from '../lib/match-status.js';

// How long after kickoff a started-but-unrecorded match is still plausibly LIVE
// when we have NO real ESPN status to trust. Group games run ~2h; knockouts can
// go to extra time + penalties (~165' of play + breaks), so allow ~3h before we
// stop calling a missing record LIVE.
const GROUP_LIVE_CUTOFF_MIN = 150;
const KO_LIVE_CUTOFF_MIN = 180;
const GROUP_STAGES = new Set(['group', 'group_stage']);

export function statusPill(match, actual = null) {
  const k = match?.kickoff_utc ? Date.parse(match.kickoff_utc) : NaN;
  const now = Date.now();
  const status = actual?.status;

  // Final-state takes priority. Trust an explicit FINAL status; otherwise fall
  // back to "has a score" for legacy/manual records that carry no status.
  const isFinal = (status && FINAL_STATUSES.has(status))
    || (!status && actual && Number.isFinite(actual.score_a));
  if (isFinal) {
    const wentToPens = status === 'STATUS_FINAL_PEN'
      || (actual?.winner && Number.isFinite(actual.score_a) && actual.score_a === actual.score_b);
    if (wentToPens) return pill('PEN', 'is-final');
    return pill('FT', 'is-final');
  }

  // STATUS-FIRST: a real ESPN LIVE status + its real clock beat any wall-clock
  // estimate. The feed knows the true minute (resumed-after-delay games, extra
  // time, shootouts); the elapsed-since-kickoff guess below is only a fallback
  // for when there's no status at all.
  if (status && LIVE_STATUSES.has(status)) {
    const m = liveMinuteLabel(actual.minute, status);
    return pill(m ? `LIVE ${m}` : 'LIVE', 'is-live');
  }

  // No kickoff or far future → schedule chip with the local time
  if (!Number.isFinite(k)) return pill('TBD', 'is-scheduled');
  if (now < k) {
    const d = new Date(k);
    // Show kickoff date+time succinctly
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return pill(`${date} · ${time}`, 'is-scheduled');
  }

  // Past kickoff, no usable status — estimate from the wall clock. Knockouts get
  // a longer window so an ET/penalties game still reads LIVE past 150'.
  const cutoff = GROUP_STAGES.has(match?.stage) ? GROUP_LIVE_CUTOFF_MIN : KO_LIVE_CUTOFF_MIN;
  const elapsedMin = (now - k) / 60000;
  if (elapsedMin < cutoff) {
    const minute = clampMinute(elapsedMin);
    return pill(`LIVE ${minute}'`, 'is-live');
  }
  // Stale (past the window) but no result — show TBD
  return pill('TBD', 'is-scheduled');
}

// Normalize the feed's minute into a display label. ESPN sends either "78'"
// (already suffixed) or "78"; preserve a present suffix, add one when bare.
function liveMinuteLabel(minute, status) {
  if (minute == null || minute === '') {
    // No clock from the feed — shootout/halftime phases read by status alone.
    if (status === 'STATUS_SHOOTOUT') return 'pens';
    if (status === 'STATUS_HALFTIME' || status === 'STATUS_HALFTIME_ET') return 'HT';
    return '';
  }
  const s = String(minute).trim();
  return /['+]$/.test(s) ? s : `${s}'`;
}

function clampMinute(elapsedMin) {
  // Soccer: 90 min regulation, ~5–15 min injury time; show 90+ once past 90.
  const m = Math.floor(elapsedMin);
  if (m <= 45) return m;
  if (m <= 60) return '45+';   // half-time window
  if (m <= 105) return m - 15; // second-half: subtract half-time
  return '90+';
}

function pill(label, cls) {
  const span = document.createElement('span');
  span.className = `status-pill ${cls}`;
  span.setAttribute('data-testid', 'status-pill');
  span.setAttribute('data-status', cls.replace('is-', ''));
  span.textContent = label;
  return span;
}
