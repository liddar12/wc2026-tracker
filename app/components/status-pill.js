/* status-pill.js — small badge for a bracket/match row.
   States: scheduled (kickoff time), LIVE (currently playing), FT (final),
   PEN (penalty-shootout result), TBD (no kickoff yet). */

export function statusPill(match, actual = null) {
  const k = match?.kickoff_utc ? Date.parse(match.kickoff_utc) : NaN;
  const now = Date.now();

  // Final-state takes priority
  if (actual && Number.isFinite(actual.score_a)) {
    const wentToPens = actual?.winner && actual.score_a === actual.score_b;
    if (wentToPens) return pill('PEN', 'is-final');
    return pill('FT', 'is-final');
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

  // Past kickoff but no actual yet — within ~2.5h window means LIVE
  const elapsedMin = (now - k) / 60000;
  if (elapsedMin < 150) {
    const minute = clampMinute(elapsedMin);
    return pill(`LIVE ${minute}'`, 'is-live');
  }
  // Stale (past 2.5h) but no result — show TBD
  return pill('TBD', 'is-scheduled');
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
