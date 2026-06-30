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
import { emptyState } from '../lib/empty-state.js';

const isPlaceholder = (n) => !n || /^\d[A-L]$|^[A-L]\d|^3[A-L/ ]|^W\d|^L\d|^1[A-L]|^2[A-L]|^RU/i.test(String(n));

function etDate(d) { return new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10); }

function todayMatches(data) {
  const today = etDate(new Date());
  return (data?.scheduleFull || []).filter((m) => {
    if (isPlaceholder(m.team_a) || isPlaceholder(m.team_b) || !m.kickoff_utc) return false;
    return etDate(new Date(m.kickoff_utc)) === today;
  });
}

// model W/D/L (fractions) for a match, oriented to our team_a. Scans the
// group_matchups buckets first, then the flat knockout_matchups array (which
// mirrors a group match row) — so knockout pairs still yield a Moneyline leg
// once the tournament leaves the group stage. Null if neither has the pair.
function modelFromRow(m, a, b) {
  const p = m.probabilities; if (!p) return null;
  const flip = m.team_a !== a;
  return {
    a: (flip ? p.team_b_wins : p.team_a_wins) / 100,
    d: p.draw / 100,
    b: (flip ? p.team_a_wins : p.team_b_wins) / 100,
  };
}
function modelWDL(data, a, b) {
  const matches = (m) => (m.team_a === a && m.team_b === b) || (m.team_a === b && m.team_b === a);
  for (const g of Object.values(data?.groupMatchups || {})) {
    for (const m of g.matches || []) {
      if (matches(m)) return modelFromRow(m, a, b);
    }
  }
  for (const m of (Array.isArray(data?.knockoutMatchups) ? data.knockoutMatchups : [])) {
    if (matches(m)) return modelFromRow(m, a, b);
  }
  return null;
}
// A match_outcomes record ({team_a, team_b, team_a_prob, draw_prob, team_b_prob})
// oriented to our team_a, or null. Shared by Kalshi + API-Football consensus.
function outcomeWDL(mo, a, b) {
  const rec = mo?.[`${a}__vs__${b}`] || mo?.[`${b}__vs__${a}`];
  if (!rec) return null;
  const flip = rec.team_a !== a;
  return { a: flip ? rec.team_b_prob : rec.team_a_prob, d: rec.draw_prob, b: flip ? rec.team_a_prob : rec.team_b_prob };
}
function marketWDL(data, a, b) {
  // Precedence: near-real-time live lines (ESPN/DraftKings, live-odds.js) →
  // multi-book CONSENSUS (API-Football, sharper than one book) → hourly Kalshi.
  const lo = data?.liveOdds || {};
  const w = (lo[`${a}__vs__${b}`] || lo[`${b}__vs__${a}`])?.wdl;
  if (w && w.home) {
    if (w.home === a) return { a: w.a, d: w.d, b: w.b };
    if (w.away === a) return { a: w.b, d: w.d, b: w.a };
  }
  return outcomeWDL(data?.consensusOdds?.match_outcomes, a, b)
      || outcomeWDL(data?.markets?.match_outcomes, a, b);
}
function liveOU(data, a, b) {
  // live book line → multi-book consensus (Over/Under 2.5) → null (model fills in).
  const lo = data?.liveOdds || {};
  const live = (lo[`${a}__vs__${b}`] || lo[`${b}__vs__${a}`])?.ou;
  if (live && typeof live.over === 'number') return live;
  const co = data?.consensusOdds?.match_outcomes || {};
  const rec = co[`${a}__vs__${b}`] || co[`${b}__vs__${a}`];
  if (rec && typeof rec.over25 === 'number') return { line: 2.5, over: rec.over25 };
  return null;
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
  // Moneyline — a SINGLE clean outcome (team to win OR draw, whichever is most
  // likely). No double-chance "X or Draw" hybrids — the bet must be unambiguous.
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
    legs.push({ mid, label, type: 'Moneyline', market: 'Moneyline', selection: top.sel, prob: top.p, ev: top.mp ? top.modelP / Math.max(top.mp, 0.02) : 1, estimated: !mkt });
  }
  // Over/Under: prefer the live book line; else model (xG → Poisson) at 2.5.
  const xg = xgFor(data, a, b);
  const lou = liveOU(data, a, b);
  if (lou && typeof lou.over === 'number') {
    legs.push(lou.over >= 0.5
      ? { mid, label, type: 'Total goals', market: 'Total goals', selection: `Over ${lou.line} goals`, prob: lou.over, ev: 1 }
      : { mid, label, type: 'Total goals', market: 'Total goals', selection: `Under ${lou.line} goals`, prob: 1 - lou.over, ev: 1 });
  } else if (xg) {
    const ov = pTotalOver(xg.la, xg.lb, 2.5);
    legs.push(ov >= 0.5
      ? { mid, label, type: 'Total goals', market: 'Total goals', selection: 'Over 2.5 goals', prob: ov, ev: 1, estimated: true }
      : { mid, label, type: 'Total goals', market: 'Total goals', selection: 'Under 2.5 goals', prob: 1 - ov, ev: 1, estimated: true });
  }
  if (xg) {
    const y = pBTTS(xg.la, xg.lb);
    legs.push(y >= 0.5
      ? { mid, label, type: 'Both teams to score', market: 'Both teams to score', selection: 'Yes', prob: y, ev: 1, estimated: true }
      : { mid, label, type: 'Both teams to score', market: 'Both teams to score', selection: 'No', prob: 1 - y, ev: 1, estimated: true });
    // Anytime goalscorer (player prop): top-rated forward on the higher-xG side.
    // No real book line yet → a clearly-tagged model estimate (upgrades to a real
    // line once the API-Football prop feed is live). "estimated" drives the tag.
    const strong = xg.la >= xg.lb ? a : b, lam = Math.max(xg.la, xg.lb);
    const fwd = topForward(data, strong);
    if (fwd) legs.push({ mid, label, type: 'Anytime goalscorer', market: 'Anytime goalscorer', selection: `${fwd} to score`, prob: 1 - Math.exp(-lam * 0.5), ev: 1, estimated: true });
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

// Exposed for tests: the full candidate-leg pool for today's matches.
export function dailyLegs(data) {
  return todayMatches(data).flatMap((m) => legsForMatch(data, m));
}

export function parlayOfTheDay(data) {
  const matches = todayMatches(data);
  if (!matches.length) return null;
  const pool = matches.flatMap((m) => legsForMatch(data, m));
  if (pool.length < 3) return null;
  // Confidence floor everywhere: never include a leg that's "unlikely to hit".
  // Per match, pickParlay takes the single most-likely clear bet (so a coin-flip
  // moneyline is naturally replaced by a more-confident prop, e.g. Over 2.5).
  const parlays = [
    { name: 'Most likely', sub: 'Three highest-probability single bets', ...pickParlay(pool, { floor: 0.5 }) },
    { name: 'Safe (diversified)', sub: 'High-confidence, spread across bet types', ...pickParlay(pool, { floor: 0.5, diverseTypes: true }) },
    { name: 'Best value', sub: 'Best model-vs-market edge', ...pickParlay(pool, { floor: 0.5, byEv: true }) },
  ].filter((p) => p.legs);
  if (!parlays.length) return null;
  const liveKeys = Object.keys(data?.liveOdds || {}).filter((k) => k !== '__ts');
  return { date: etDate(new Date()), gameCount: matches.length, parlays, live: liveKeys.length > 0, oddsTs: data?.liveOdds?.__ts || null };
}

function agoLabel(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

export function renderParlayOfDay(data) {
  const p = parlayOfTheDay(data);
  if (!p) {
    // No parlay, but real-team games ARE on today (e.g. knockout lines not yet
    // modeled) → surface an empty-state rather than a silent blank fragment.
    // Truly no games today → nothing to say, stay empty.
    if (todayMatches(data).length) {
      const sec = document.createElement('section');
      sec.className = 'home-card parlay-card';
      sec.dataset.testid = 'parlay-of-day';
      sec.appendChild(emptyState("Parlay returns once today's matches are priced", {
        detail: 'Knockout lines are being modeled',
      }));
      return sec;
    }
    return document.createDocumentFragment();
  }
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
          <span class="parlay-leg-main">
            <span class="parlay-leg-sel"><span class="parlay-leg-market">${escapeHtml(l.market || l.type)}</span> — ${escapeHtml(l.selection)}${l.estimated ? ' <em class="parlay-leg-est" title="Model estimate — no posted book line yet">model est.</em>' : ''}</span>
            <span class="parlay-leg-match">${escapeHtml(l.label)}</span>
          </span>
          <span class="parlay-leg-prob">${Math.round(l.prob * 100)}%</span></li>`).join('')}
      </ul>
    </div>`).join('');
  const freshness = p.live
    ? `<span class="parlay-live" data-testid="parlay-live">🟢 Live odds · ${escapeHtml(agoLabel(p.oddsTs))}</span>`
    : '<span class="home-card-meta muted">hourly market</span>';
  sec.innerHTML = `
    <h2 class="home-card-title">🎯 Parlay of the Day <span class="home-card-meta muted">${p.gameCount} game${p.gameCount === 1 ? '' : 's'} today</span> ${freshness}</h2>
    <div class="parlay-grid">${cards}</div>
    <p class="muted" style="font-size:11px;margin:8px 0 0;">Each leg is a single clear bet. Model blended with ${p.live ? 'near-real-time book' : 'market'} odds; legs tagged <em>model est.</em> are model estimates with no posted book line yet. For entertainment, <strong>not betting advice</strong>. Combined odds assume independent legs.</p>`;
  return sec;
}
