/* parlay.js — BR-8 "Parlay of the Day".
 *
 * From TODAY's matches, builds three 3-leg parlays from the model+market data:
 *   • Most likely  — the 3 highest-probability legs (distinct matches)
 *   • Safe         — highest-probability but DIVERSIFIED across bet types
 *   • Best value   — best model-vs-market expected value (Kalshi as the price)
 * Legs span Moneyline, Over/Under total goals, Both-Teams-To-Score, and an
 * (experimental) anytime-scorer. Probabilities blend our model with Kalshi
 * per-match odds where available. Combined probability assumes independence
 * (one leg per match keeps that honest). Returns null when no real-team games
 * are on today.
 *
 * NOT betting advice — model projections for entertainment (disclaimer shown).
 */
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from './team-flag.js';

const isPlaceholder = (n) => !n || /^\d[A-L]$|^[A-L]\d|^3[A-L/ ]|^W\d|^L\d|^1[A-L]|^2[A-L]|^RU/i.test(String(n));

function etDate(d) { return new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10); }

function todayMatches(data) {
  const today = etDate(new Date());
  return (data?.scheduleFull || []).filter((m) => {
    if (isPlaceholder(m.team_a) || isPlaceholder(m.team_b) || !m.kickoff_utc) return false;
    return etDate(new Date(m.kickoff_utc)) === today;
  });
}

// model W/D/L (fractions) for a match, from group_matchups; null if absent.
function modelWDL(data, a, b) {
  for (const g of Object.values(data?.groupMatchups || {})) {
    for (const m of g.matches || []) {
      if ((m.team_a === a && m.team_b === b) || (m.team_a === b && m.team_b === a)) {
        const p = m.probabilities; if (!p) return null;
        const flip = m.team_a !== a;
        return {
          a: (flip ? p.team_b_wins : p.team_a_wins) / 100,
          d: p.draw / 100,
          b: (flip ? p.team_a_wins : p.team_b_wins) / 100,
        };
      }
    }
  }
  return null;
}
function marketWDL(data, a, b) {
  const mo = data?.markets?.match_outcomes || {};
  const rec = mo[`${a}__vs__${b}`] || mo[`${b}__vs__${a}`];
  if (!rec) return null;
  const flip = rec.team_a !== a;
  return { a: flip ? rec.team_b_prob : rec.team_a_prob, d: rec.draw_prob, b: flip ? rec.team_a_prob : rec.team_b_prob };
}
function xgFor(data, a, b) {
  for (const r of Object.values(data?.xg || {})) {
    if (!r || typeof r !== 'object') continue;
    if ((r.team_a === a && r.team_b === b) || (r.team_a === b && r.team_b === a)) {
      return { la: Number(r.team_a_xg) || 1.3, lb: Number(r.team_b_xg) || 1.3 };
    }
  }
  return null;
}

const pTotalOver = (la, lb, line = 2.5) => {
  const L = la + lb; const le2 = Math.exp(-L) * (1 + L + (L * L) / 2);
  return line === 2.5 ? 1 - le2 : 1 - le2; // 2.5 line → P(>=3)=1-P(<=2)
};
const pBTTS = (la, lb) => (1 - Math.exp(-la)) * (1 - Math.exp(-lb));

function legsForMatch(data, m) {
  const a = m.team_a, b = m.team_b, label = `${a} v ${b}`, mid = m.match_id || `${a}__vs__${b}`;
  const legs = [];
  // Moneyline (model blended 50/50 with market where present)
  const mdl = modelWDL(data, a, b);
  if (mdl) {
    const mkt = marketWDL(data, a, b);
    const blend = (k) => mkt ? (mdl[k] + mkt[k]) / 2 : mdl[k];
    const outs = [
      { sel: `${a} to win`, p: blend('a'), mp: mkt?.a, modelP: mdl.a },
      { sel: 'Draw', p: blend('d'), mp: mkt?.d, modelP: mdl.d },
      { sel: `${b} to win`, p: blend('b'), mp: mkt?.b, modelP: mdl.b },
    ].sort((x, y) => y.p - x.p);
    const top = outs[0];
    legs.push({ mid, label, type: 'Moneyline', selection: top.sel, prob: top.p, ev: top.mp ? top.modelP / Math.max(top.mp, 0.02) : 1 });
    legs.push({ mid, label, type: 'Double chance', selection: `${outs[0].sel.replace(' to win', '')} or ${outs[1].sel.replace(' to win', '')}`.replace('Draw or', 'Draw or').slice(0, 40), prob: outs[0].p + outs[1].p, ev: 1 });
  }
  // Over/Under + BTTS from xG
  const xg = xgFor(data, a, b);
  if (xg) {
    const ov = pTotalOver(xg.la, xg.lb, 2.5);
    legs.push(ov >= 0.5
      ? { mid, label, type: 'Total goals', selection: 'Over 2.5', prob: ov, ev: 1 }
      : { mid, label, type: 'Total goals', selection: 'Under 2.5', prob: 1 - ov, ev: 1 });
    const y = pBTTS(xg.la, xg.lb);
    legs.push(y >= 0.5
      ? { mid, label, type: 'Both teams to score', selection: 'Yes', prob: y, ev: 1 }
      : { mid, label, type: 'Both teams to score', selection: 'No', prob: 1 - y, ev: 1 });
    // experimental anytime scorer: top-rated forward on the higher-xG side
    const strong = xg.la >= xg.lb ? a : b, lam = Math.max(xg.la, xg.lb);
    const fwd = topForward(data, strong);
    if (fwd) legs.push({ mid, label, type: 'Anytime scorer', selection: `${fwd} (exp.)`, prob: 1 - Math.exp(-lam * 0.5), ev: 1, experimental: true });
  }
  return legs.filter((l) => l.prob > 0 && l.prob < 0.995);
}

function topForward(data, team) {
  const players = data?.players || [];
  let best = null;
  for (const p of (Array.isArray(players) ? players : [])) {
    if (p.team === team && (p.position === 'FWD' || p.position === 'F') && typeof p.scoring === 'number') {
      if (!best || p.scoring > best.scoring) best = p;
    }
  }
  return best?.name || null;
}

function pickParlay(legs, { floor = 0, diverseTypes = false, byEv = false } = {}) {
  const sorted = legs.filter((l) => l.prob >= floor).sort((x, y) => byEv ? (y.ev - x.ev || y.prob - x.prob) : (y.prob - x.prob));
  const out = []; const usedMatch = new Set(); const usedType = new Set();
  for (const l of sorted) {
    if (usedMatch.has(l.mid)) continue;
    if (diverseTypes && usedType.has(l.type)) continue;
    out.push(l); usedMatch.add(l.mid); usedType.add(l.type);
    if (out.length === 3) break;
  }
  if (!out.length) return null;
  const combined = out.reduce((p, l) => p * l.prob, 1);
  return { legs: out, combinedProb: combined, odds: 1 / combined };
}

export function parlayOfTheDay(data) {
  const matches = todayMatches(data);
  if (!matches.length) return null;
  const pool = matches.flatMap((m) => legsForMatch(data, m));
  if (pool.length < 3) return null;
  const parlays = [
    { name: 'Most likely', sub: 'Three highest-probability legs', ...pickParlay(pool) },
    { name: 'Safe (diversified)', sub: 'High-confidence, spread across bet types', ...pickParlay(pool, { floor: 0.5, diverseTypes: true }) },
    { name: 'Best value', sub: 'Best model-vs-market edge', ...pickParlay(pool, { floor: 0.45, byEv: true }) },
  ].filter((p) => p.legs);
  if (!parlays.length) return null;
  return { date: etDate(new Date()), gameCount: matches.length, parlays };
}

export function renderParlayOfDay(data) {
  const p = parlayOfTheDay(data);
  if (!p) return document.createDocumentFragment();
  const sec = document.createElement('section');
  sec.className = 'home-card parlay-card';
  sec.dataset.testid = 'parlay-of-day';
  const cards = p.parlays.map((par) => `
    <div class="parlay" data-testid="parlay">
      <div class="parlay-head"><span class="parlay-name">${escapeHtml(par.name)}</span>
        <span class="parlay-odds">${par.combinedProb >= 0.01 ? Math.round(par.combinedProb * 100) + '% · ' : ''}@ ${par.odds.toFixed(2)}</span></div>
      <div class="parlay-sub muted">${escapeHtml(par.sub)}</div>
      <ul class="parlay-legs">
        ${par.legs.map((l) => `<li class="parlay-leg">
          <span class="parlay-leg-main">${escapeHtml(l.label)}<span class="parlay-leg-sel">${escapeHtml(l.selection)}${l.experimental ? ' ⚠️' : ''}</span></span>
          <span class="parlay-leg-prob">${Math.round(l.prob * 100)}%</span></li>`).join('')}
      </ul>
    </div>`).join('');
  sec.innerHTML = `
    <h2 class="home-card-title">🎯 Parlay of the Day <span class="home-card-meta muted">${p.gameCount} game${p.gameCount === 1 ? '' : 's'} today</span></h2>
    <div class="parlay-grid">${cards}</div>
    <p class="muted" style="font-size:11px;margin:8px 0 0;">Model projections blended with market odds — for entertainment, <strong>not betting advice</strong>. Combined odds assume independent legs.</p>`;
  return sec;
}
