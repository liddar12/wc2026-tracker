/* update-toast.js — slide-in toast notification when the data version
   has changed since the user's last visit. Auto-dismisses in 4s; tap
   to dismiss early. */

import { escapeHtml } from './lib/escape.js';
import { formatLastUpdated } from './data-loader.js';

const LS_KEY = 'wc26.lastSeenDataVersion';
const LS_KALSHI_SNAP = 'wc26.lastKalshi';

function readLastSeen() {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
function persistLastSeen(version) {
  try { localStorage.setItem(LS_KEY, version); } catch {}
}
function readKalshiSnap() {
  try { const raw = localStorage.getItem(LS_KALSHI_SNAP); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function persistKalshiSnap(snap) {
  try { localStorage.setItem(LS_KALSHI_SNAP, JSON.stringify(snap)); } catch {}
}

export function showUpdateToastIfNew(data) {
  const current = data?.meta?.data_version;
  if (!current) return;
  const last = readLastSeen();
  // Build a current Kalshi snapshot now so we can persist it post-diff
  const currentSnap = buildKalshiSnap(data);
  if (!last) {
    persistLastSeen(current);
    persistKalshiSnap(currentSnap);
    return;
  }
  if (last === current) return;
  // Data is newer than last visit — compute diff
  const summary = buildDiffSummary(data, currentSnap);
  persistLastSeen(current);
  persistKalshiSnap(currentSnap);
  spawnToast(current, summary);
}

function buildKalshiSnap(data) {
  const rows = data?.markets?.tournament_winner || [];
  const snap = {};
  for (const r of rows) {
    if (r?.team && typeof r.prob_pct === 'number') snap[r.team] = r.prob_pct;
  }
  return snap;
}

function buildDiffSummary(data, currentSnap) {
  // Compute changes since last localStorage snapshot. Returns short summary
  // strings ranked by relevance.
  const parts = [];
  // Kalshi top movers since last visit (>=1.0pp swing)
  const prev = readKalshiSnap() || {};
  const movers = [];
  for (const [team, prob] of Object.entries(currentSnap)) {
    const before = prev[team];
    if (typeof before !== 'number') continue;
    const delta = prob - before;
    if (Math.abs(delta) >= 1.0) movers.push({ team, delta });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (movers.length) {
    const top = movers[0];
    parts.push(`${top.team} ${top.delta >= 0 ? '+' : ''}${top.delta.toFixed(1)}pp Kalshi`);
  }
  // Newly added match results
  const actuals = data?.actualResults || {};
  let resultCount = 0;
  for (const stage of ['group_stage','round_of_32','round_of_16','quarterfinals','semifinals','third_place','final']) {
    const tier = actuals[stage] || {};
    for (const rec of Object.values(tier)) {
      if (rec && typeof rec === 'object' && Number.isFinite(rec.score_a) && Number.isFinite(rec.score_b)) resultCount++;
    }
  }
  if (resultCount > (prev.__resultCount__ || 0)) {
    const diff = resultCount - (prev.__resultCount__ || 0);
    parts.unshift(`${diff} new result${diff === 1 ? '' : 's'}`);
  }
  // Lineups freshness
  const lineupsUpdated = data?.lineups?.__meta__?.updated_at || data?.lineups?.updated_at;
  if (lineupsUpdated) {
    const recent = Date.now() - Date.parse(lineupsUpdated) < 3600 * 1000;
    if (recent) parts.push('new lineups');
  }
  if (!parts.length) return null;
  return parts.slice(0, 3).join(' · ');
}

function spawnToast(versionIso, summary) {
  // Avoid duplicate toasts on rapid re-renders
  if (document.querySelector('.wc-toast')) return;
  const toast = document.createElement('div');
  toast.className = 'wc-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const summaryLine = summary
    ? `<span class="wc-toast-summary muted">${escapeHtml(summary)}</span>`
    : '';
  toast.innerHTML = `
    <span class="wc-toast-dot" aria-hidden="true"></span>
    <span class="wc-toast-body">
      Data refreshed <strong>${escapeHtml(formatLastUpdated(versionIso))}</strong>
      ${summaryLine}
    </span>
    <button class="wc-toast-close" aria-label="Dismiss" type="button">&times;</button>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  const dismiss = () => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 280);
  };
  toast.querySelector('.wc-toast-close').addEventListener('click', dismiss);
  toast.addEventListener('click', (e) => { if (!e.target.closest('.wc-toast-close')) dismiss(); });
  setTimeout(dismiss, 4500);
}

