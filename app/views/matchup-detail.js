/* matchup-detail.js — single matchup deep dive with picks.
 *
 * Section order (top to bottom):
 *   1. Header (teams)
 *   2. Model + Market grid (side-by-side ≥720px)
 *   3. Your pick
 *   4. When + where + how to watch
 *   5. Lineups, referee, H2H, form, scorers, weather, travel, xG
 *   6. Final result (when present)
 */
import { escapeHtml } from '../lib/escape.js';
import { confidenceBar } from '../components/confidence-bar.js';
import { marketOddsSection } from '../components/market-odds.js';
import { watchlistStar } from '../components/watchlist-star.js';
import { sectionHeading } from '../components/tooltip.js';
import { upsetBadges } from '../components/upset-badge.js';
import { flagFor } from '../components/team-flag.js';
import { whenWhereWatch } from '../components/when-where-watch.js';
import { lineupsSection } from '../components/lineups.js';
import { matchEventsSection } from '../components/match-events.js';
import { suspendedForMatch } from '../lib/availability.js';
import { actualForCard } from '../components/large-match-card.js';
import { liveWinProbability } from '../components/win-probability.js';
import { configureInplay } from '../lib/win-prob.js';
import { refereeSection } from '../components/referee.js';
import { h2hSection } from '../components/h2h.js';
import { formSection } from '../components/form.js';
import { scorersSection } from '../components/scorers.js';
import { weatherSection } from '../components/weather.js';
import { travelRestSection } from '../components/travel-rest.js';
import { xgSection } from '../components/xg.js';
import { renderMatchStats } from '../components/match-stats.js';
// R18: live matches get the 10s extremes sampler; others the cron-fed strip.
import { momentumSection } from '../live-momentum.js';
import { setPick, getPick, clearPick } from '../state.js';
import { describePrediction, actualChoice } from '../predictions.js';
import { modelPickForMatch, stackMatchTriplet } from '../lib/model-pick.js';
import { conformalThreshold, predictionSet, safeSetLabel } from '../lib/conformal.js';
import { getActiveModel, MODEL_LABELS } from '../lib/active-model.js';
import { mergedMarkets } from '../markets.js';
import { winnerFromRecord, methodOfVictory, isFinalStatus } from '../lib/match-status.js';
import { t } from '../lib/i18n.js';
import { previewSection } from '../components/match-preview.js';
import { luckCheckSection } from '../components/luck-check.js';
import { crowdFactorSection } from '../components/crowd-factor.js';
import { buildMatchShareUrl, tryShareViaNavigator } from '../share-match.js';

export function renderMatchupDetail(root, data, params) {
  const match = resolveMatch(data, params.team_a, params.team_b);
  if (!match) {
    root.innerHTML = '<p class="loading">Matchup not found.</p>';
    return;
  }
  // R18: apply the cron-self-tuned in-play parameters (red-card multipliers,
  // tilt cap) before any live widget computes — no-op on the {} fallback.
  configureInplay(data.inplayParams);
  // Knockout fixtures (from scheduleFull) carry no model-prediction fields —
  // gate the model/market grid so we render the team-keyed sections (score,
  // when/where, lineups, refs, H2H, form, weather, xG) without throwing on the
  // missing prediction data.
  const hasModel = Number.isFinite(match.win_confidence_pct);

  const teamA = data.teams[match.team_a];
  const teamB = data.teams[match.team_b];

  // Header — wraps a team-color gradient banner (Apple Sports style) above
  // the team names + group line.
  const header = document.createElement('div');
  header.className = 'match-detail-header lcard';
  header.style.padding = '0';
  header.style.margin = '0 0 14px';

  const banner = document.createElement('div');
  banner.className = 'lcard-banner';
  banner.dataset.teamA = match.team_a || '';
  banner.dataset.teamB = match.team_b || '';
  header.appendChild(banner);
  // Apply team-color gradient asynchronously
  (async () => {
    try {
      const { getTeamColors } = await import('../team-skin.js');
      const [ca, cb] = await Promise.all([getTeamColors(match.team_a), getTeamColors(match.team_b)]);
      const a = (ca && ca.primary) || 'var(--primary)';
      const b = (cb && cb.primary) || 'var(--accent)';
      banner.style.background = `linear-gradient(135deg, ${a} 0%, ${a} 45%, ${b} 55%, ${b} 100%)`;
    } catch {}
  })();

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'lcard-body';
  bodyWrap.style.marginTop = '-32px';

  const starRow = document.createElement('div');
  starRow.className = 'detail-star-row';
  starRow.appendChild(shareButton(match));
  starRow.appendChild(watchlistStar(match));
  bodyWrap.appendChild(starRow);
  const teamsRow = document.createElement('div');
  teamsRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;';
  // Real result (final or in-progress): show the score between the teams
  // instead of a bare "vs" — the detail page previously never displayed it.
  const found = actualForCard(data.actualResults, { stage: match.stage || 'group', team_a: match.team_a, team_b: match.team_b });
  // The raw record carries status + winner (the regulation score is a tie for an
  // ET/pen knockout). Use match-status helpers for the real result label (FT /
  // AET / pens + shootout suffix) and the winning side (for the .is-winner tag),
  // instead of the previous hardcoded "FT".
  const rec = resultRecord(data.actualResults, match);
  const mov = found?.mode === 'final' ? methodOfVictory(rec) : null;
  const winner = found?.mode === 'final' ? winnerFromRecord(rec, match.team_a, match.team_b) : null;
  const finalLabel = mov ? `<small>${escapeHtml(mov.label)}${escapeHtml(mov.suffix)}</small>` : '';
  const liveLabel = found?.mode === 'live'
    ? `<small class="detail-score-live" data-testid="detail-live">LIVE${found.actual.minute ? ' ' + escapeHtml(String(found.actual.minute)) + "'" : ''}</small>`
    : '';
  const centre = found
    ? `<span class="detail-score" data-testid="detail-score">${found.actual.score_a}&thinsp;–&thinsp;${found.actual.score_b}${
        found.mode === 'final' ? finalLabel : liveLabel}</span>`
    : '<span class="muted">vs</span>';
  const winA = winner === match.team_a ? ' is-winner' : '';
  const winB = winner === match.team_b ? ' is-winner' : '';
  teamsRow.innerHTML = `
    <a class="team-link" href="#/team/name/${encodeURIComponent(match.team_a)}" style="display:flex;align-items:center;gap:8px;" aria-label="${escapeHtml(match.team_a)} team page">
      <span class="flag" aria-hidden="true" style="font-size:32px;">${flagFor(match.team_a)}</span>
      <strong class="team-name${winA}">${escapeHtml(match.team_a)}</strong>
    </a>
    ${centre}
    <a class="team-link team-link-rtl" href="#/team/name/${encodeURIComponent(match.team_b)}" style="display:flex;align-items:center;gap:8px;" aria-label="${escapeHtml(match.team_b)} team page">
      <strong class="team-name${winB}">${escapeHtml(match.team_b)}</strong>
      <span class="flag" aria-hidden="true" style="font-size:32px;">${flagFor(match.team_b)}</span>
    </a>
  `;
  bodyWrap.appendChild(teamsRow);
  const groupLine = document.createElement('div');
  groupLine.className = 'muted';
  groupLine.style.fontSize = '12px';
  // Group matches show "Group X"; knockout matches show the round name.
  groupLine.textContent = (match.stage && match.stage !== 'group')
    ? prettyStageName(match.stage)
    : `Group ${match.group || teamA?.group || '?'}`;
  bodyWrap.appendChild(groupLine);
  header.appendChild(bodyWrap);
  root.appendChild(header);

  // When + where + how to watch — pulled up under the group label per UX
  // request. Was previously buried below model + composite + picks; users
  // wanted it adjacent to the team names so kickoff/venue is the first
  // thing they see after the matchup.
  root.appendChild(whenWhereWatch(match, data.scheduleFull, data.venues));

  // Model + Market grid. The market column renders for EVERY match (decoupled
  // from the model gate — model-less rows fall back to the tournament-winner
  // odds). The model column adapts: knockout rows lead with a "to advance %"
  // headline + the regulation W/D/L bar; group rows keep the full composite /
  // why / upset breakdown; an unmodeled row contributes no model column.
  const isKnockout = match.is_knockout === true || (!!match.stage && match.stage !== 'group');
  const hasAdvance = Number.isFinite(match.advance_pct_a) || Number.isFinite(match.advance_pct_b);
  if (hasModel || hasAdvance) {
    const grid = document.createElement('div');
    grid.className = 'match-prediction-grid';

    const modelCol = document.createElement('div');
    modelCol.className = 'model-col';

    if (isKnockout && hasModel) {
      // Knockout headline: each side's to-advance % (single-elimination, so the
      // model question is "who reaches the next round"), with the regulation
      // W/D/L bar underneath for the 90-minute outcome.
      modelCol.appendChild(advanceHeadline(match));
      modelCol.appendChild(confidenceBar(match, { title: 'Regulation result (W / D / L)' }));
      modelCol.appendChild(pickPill(match, data));
    } else if (hasModel) {
      modelCol.appendChild(confidenceBar(match, { title: 'Model' }));
      modelCol.appendChild(pickPill(match, data));

      const compSec = document.createElement('div');
      compSec.className = 'section model-section';
      compSec.appendChild(sectionHeading('Composite breakdown', 'composite'));
      const compGrid = document.createElement('div');
      compGrid.className = 'composite-grid';
      compGrid.appendChild(compositeCol(teamA, match.composite_a));
      compGrid.appendChild(compositeCol(teamB, match.composite_b));
      compSec.appendChild(compGrid);
      modelCol.appendChild(compSec);

      const reason = document.createElement('div');
      reason.className = 'section model-section';
      reason.innerHTML = `<h2>Why this prediction</h2><p>${escapeHtml(describePrediction(match, data.teams))}</p>`;
      modelCol.appendChild(reason);

      const upsets = document.createElement('div');
      upsets.className = 'section model-section';
      upsets.appendChild(sectionHeading('Upset risk signals', 'upset'));
      const legend = document.createElement('p');
      legend.className = 'upset-legend muted';
      legend.textContent = 'These flag scenarios where the underdog could outperform — not a pick against the favorite.';
      upsets.appendChild(legend);
      upsets.appendChild(upsetBadges(match.upset_risk?.indicators));
      modelCol.appendChild(upsets);
    }

    const marketCol = document.createElement('div');
    marketCol.className = 'market-col';
    marketCol.appendChild(marketOddsSection(match, mergedMarkets(data)));

    if (modelCol.childNodes.length) grid.append(modelCol, marketCol);
    else grid.append(marketCol);
    root.appendChild(grid);
  }

  // Crowd factor — a known partisan-crowd asymmetry (data/crowd.json) shown as
  // a labelled layer on top of the model's advance %: with vs without crowd.
  // Fixed literature-anchored prior, never feeds the projection (see
  // app/lib/crowd-adjust.js). Empty fragment when the match has no crowd entry.
  root.appendChild(crowdFactorSection(match, data));

  // Luck check — right after the model grid (the "To advance" block) per UX
  // request: how each side got here + a live this-match luck ledger that fills
  // in on every data:live-refresh re-render. Display-only, never feeds the
  // model (docs/LUCK_ANALYSIS.md); empty fragment when no team has a profile.
  root.appendChild(luckCheckSection(match, data));

  // RJ30.2 Match Intelligence — REAL ESPN boxscore stats + a momentum strip,
  // mounted next to the model/xG grid (where match analysis belongs). Both
  // return an empty DocumentFragment for fixtures with no data.matchStats row
  // (the vast majority pre-tournament), so nothing renders until a match has
  // stats. Stats first (possession / shots / passing / shots-vs-model-xG +
  // computed insights), momentum after (shot-pressure sparkline + goal markers).
  root.appendChild(renderMatchStats(match, data));
  root.appendChild(momentumSection(match, data));

  // AI match preview / recap — mounts near the model grid (where a preview
  // belongs) and ships DORMANT: previewSection returns an empty
  // DocumentFragment when data.previews has no entry for this pair, so this is
  // invisible/silent until scripts/generate_previews.py writes previews.json.
  root.appendChild(previewSection(match, data));

  // RJ30-5: live win-probability timeline. Pure display — renders nothing
  // unless the match is live AND the row carries a model prior (group
  // `probabilities` or knockout `advance_pct_*`). Reuses the `found` computed
  // above; updates on every `data:live-refresh` re-render (scrollY preserved by
  // pendingLiveRefresh). Never touches the scoring/bracket path.
  root.appendChild(liveWinProbability(match, found));

  // Picks (full width below grid)
  const picks = document.createElement('div');
  picks.className = 'section';
  picks.innerHTML = `<h2>${escapeHtml(t('matchup.yourPick'))}</h2>`;
  picks.appendChild(renderPickRow(match));
  root.appendChild(picks);

  // Phase-2 sections (each renders gracefully when its data is missing).
  // whenWhereWatch moved to the top of the page (right under the group label).
  root.appendChild(availabilitySection(match, data));
  root.appendChild(lineupsSection(match, data.lineups));
  root.appendChild(matchEventsSection(match, data.matchEvents));
  root.appendChild(refereeSection(match, data));
  root.appendChild(h2hSection(match, data.h2h));
  root.appendChild(formSection(match, data.form));
  root.appendChild(scorersSection(match, data.scorers));
  root.appendChild(weatherSection(match, data.scheduleFull, data.weather));
  root.appendChild(travelRestSection(match, data.fatigue));
  root.appendChild(xgSection(match, data.xg));

  // Actual result if known. Drive the winner + method from the match-status
  // helpers so EVERY final knockout outcome shows — a regulation win (FT), an
  // extra-time win (AET), or a shootout (pens, with the tally suffix) — not only
  // ties broken by ET/pens. Group draws still read "Drawn".
  const finalRec = resultRecord(data.actualResults, match);
  if (finalRec && isFinalStatus(finalRec)) {
    const w = winnerFromRecord(finalRec, match.team_a, match.team_b);
    const mv = methodOfVictory(finalRec);
    let label;
    if (w) {
      // 'FT' is implied for a regulation win; only annotate ET/pens.
      const how = mv.method === 'pens' ? ` on penalties${mv.suffix}`
        : mv.method === 'aet' ? ' after extra time'
        : '';
      label = `${w} won${how}`;
    } else {
      const actual = actualChoice(match, data.actualResults);
      label = actual === 'team_a' ? `${match.team_a} won`
        : actual === 'team_b' ? `${match.team_b} won`
        : 'Drawn';
    }
    const res = document.createElement('div');
    res.className = 'section';
    res.dataset.testid = 'final-result';
    res.innerHTML = `<h2>${escapeHtml(t('matchup.finalResult'))}</h2><p><strong>${escapeHtml(label)}</strong></p>`;
    root.appendChild(res);
  }
}

// Availability for THIS match — suspended players per side (reds / 2-yellow
// bans), from match events. ESPN has no WC injury data, so suspensions are the
// reliable availability signal; this surfaces it on the match (not just the
// Injuries page). Renders nothing pre-tournament / when nobody is banned.
function availabilitySection(match, data) {
  const susp = suspendedForMatch(data, match);
  const rows = [
    ...susp.team_a.map((s) => ({ ...s, team: match.team_a })),
    ...susp.team_b.map((s) => ({ ...s, team: match.team_b })),
  ];
  if (!rows.length) return document.createDocumentFragment();
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.dataset.testid = 'match-availability';
  sec.innerHTML = `
    <h2>Unavailable (suspended)</h2>
    <ul class="ev-list">
      ${rows.map((s) => `
        <li class="ev-row">
          <span class="ev-minute">${flagFor(s.team)}</span>
          <span class="ev-player"><strong>${escapeHtml(s.player)}</strong>
            <span class="muted">${escapeHtml(s.team)} · ${escapeHtml(s.reason)} — suspended this match</span>
          </span>
        </li>`).join('')}
    </ul>
    <p class="muted" style="font-size:11px;margin:6px 0 0;">From match cards (red / two accumulated yellows). ESPN publishes no World Cup injury data.</p>
  `;
  return sec;
}

// Share this matchup — mirrors the bracket Share button. Emits the real
// `/m/<A>__vs__<B>` OG path via buildMatchShareUrl and hands it to
// tryShareViaNavigator (navigator.share → clipboard fallback). `.icon-btn` has
// no project CSS, so the 44px touch target + neutral chrome are set inline; no
// transition/animation → reduced-motion safe by construction.
function shareButton(match) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.setAttribute('aria-label', 'Share this matchup');
  btn.style.cssText = 'appearance:none;background:transparent;border:0;'
    + 'min-width:44px;min-height:44px;padding:4px;display:inline-flex;'
    + 'align-items:center;justify-content:center;color:var(--text-muted);'
    + 'cursor:pointer;font-size:18px;line-height:1;'
    + '-webkit-tap-highlight-color:transparent;touch-action:manipulation;';
  // Unicode share glyph; decorative (the aria-label carries the meaning).
  btn.innerHTML = '<span aria-hidden="true">↗︎</span>';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tryShareViaNavigator(
      buildMatchShareUrl(match.team_a, match.team_b),
      `${match.team_a} vs ${match.team_b}`,
    );
  });
  return btn;
}

function renderPickRow(match) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'pick-row';

  const current = getPick(match);
  const choices = [
    { key: 'team_a', label: match.team_a },
    { key: 'draw', label: 'Draw' },
    { key: 'team_b', label: match.team_b }
  ];
  for (const c of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick-btn' + (current?.choice === c.key ? ' is-picked' : '');
    btn.textContent = c.label;
    btn.addEventListener('click', () => {
      const now = getPick(match);
      if (now?.choice === c.key) clearPick(match);
      else setPick(match, c.key);
    });
    row.appendChild(btn);
  }
  wrap.appendChild(row);

  if (current) {
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.style.fontSize = '12px';
    meta.textContent = `Locked in ${new Date(current.picked_at).toLocaleDateString()} — tap your pick again to clear.`;
    wrap.appendChild(meta);
  }
  return wrap;
}

function compositeCol(team, fallbackComposite) {
  const col = document.createElement('div');
  col.className = 'col';
  const c = team?.composite ?? fallbackComposite;
  const sub = team?.sub_ratings || {};
  col.innerHTML = `
    <h3><span>${escapeHtml(team?.name || '?')}</span><span>${c?.toFixed?.(1) ?? '—'}</span></h3>
    <div class="sub-row"><span>Mine</span><strong>${num(sub.mine)}</strong></div>
    <div class="sub-row"><span>Elo</span><strong>${num(sub.elo_scaled)}</strong></div>
    <div class="sub-row"><span>TMV</span><strong>${num(sub.tmv_scaled)}</strong></div>
    <div class="sub-row"><span>Qual</span><strong>${num(sub.qual_scaled)}</strong></div>
  `;
  return col;
}

function num(v) { return typeof v === 'number' ? v.toFixed(1) : '—'; }

// Knockout headline — each side's model probability of ADVANCING (reaching the
// next round). Single-elimination has no draw outcome, so this leads the model
// column; the regulation W/D/L bar renders beneath it.
function advanceHeadline(match) {
  const sec = document.createElement('div');
  sec.className = 'section model-section advance-headline';
  sec.dataset.testid = 'advance-headline';
  const pa = Number.isFinite(match.advance_pct_a) ? `${match.advance_pct_a.toFixed(0)}%` : '—';
  const pb = Number.isFinite(match.advance_pct_b) ? `${match.advance_pct_b.toFixed(0)}%` : '—';
  sec.innerHTML = `
    <h2>To advance</h2>
    <div class="advance-row">
      <span class="advance-side">
        <span class="flag" aria-hidden="true">${flagFor(match.team_a)}</span>
        <span class="advance-team">${escapeHtml(match.team_a)}</span>
        <strong class="advance-pct">${pa}</strong>
      </span>
      <span class="advance-side advance-side-rtl">
        <strong class="advance-pct">${pb}</strong>
        <span class="advance-team">${escapeHtml(match.team_b)}</span>
        <span class="flag" aria-hidden="true">${flagFor(match.team_b)}</span>
      </span>
    </div>
  `;
  return sec;
}

function prettyStageName(stage) {
  return {
    round_of_32: 'Round of 32',
    round_of_16: 'Round of 16',
    quarterfinals: 'Quarterfinal',
    semifinals: 'Semifinal',
    third_place: 'Third-place play-off',
    final: 'Final',
  }[stage] || 'Knockout stage';
}

// actual_results is keyed by tier; group fixtures live under group_stage, knockout
// fixtures under their stage token. Return the raw record (with status + winner)
// for THIS match, either team orientation, so the header can name the winner and
// the result method via the match-status helpers.
const RESULT_TIER_FOR_STAGE = {
  round_of_32: 'round_of_32', round_of_16: 'round_of_16',
  quarterfinals: 'quarterfinals', semifinals: 'semifinals',
  third_place: 'third_place', final: 'final',
};
function resultRecord(actualResults, match) {
  const tierKey = RESULT_TIER_FOR_STAGE[match?.stage] || 'group_stage';
  const tier = actualResults?.[tierKey] || {};
  return tier[`${match.team_a}__vs__${match.team_b}`]
    || tier[`${match.team_b}__vs__${match.team_a}`]
    || null;
}

// Resolve a matchup by team names. Group-stage matches live in groupMatchups
// (keyed by group letter, carrying the model-prediction fields). Knockout
// fixtures with a model live in knockoutMatchups (an array of match rows mirroring
// group rows plus advance_pct_a/_b) — scan it BEFORE the schedule so a resolved
// knockout pair carries its model fields (hasModel true → the model+market grid
// renders). Only fall back to scheduleFull for fixtures with no modeled row; that
// fallback row has no model fields and the view gates those out.
export function resolveMatch(data, a, b) {
  if (!a || !b) return null;
  const groupMatchups = data?.groupMatchups || {};
  for (const [g, info] of Object.entries(groupMatchups)) {
    for (const m of (info?.matches || [])) {
      if ((m.team_a === a && m.team_b === b) || (m.team_a === b && m.team_b === a)) {
        return { ...m, group: g };
      }
    }
  }
  for (const m of (data?.knockoutMatchups || [])) {
    if ((m.team_a === a && m.team_b === b) || (m.team_a === b && m.team_b === a)) {
      return { ...m };
    }
  }
  for (const row of (data?.scheduleFull || [])) {
    if ((row.team_a === a && row.team_b === b) || (row.team_a === b && row.team_b === a)) {
      return { ...row };
    }
  }
  return null;
}

// The headline pick follows the ACTIVE forecast model (default: "J5L AI
// Enhanced"), not a hard-coded hybrid — so switching the model in the picker (or
// the app default) changes this pick too.
function pickPill(match, data) {
  const wrap = document.createElement('div');
  wrap.className = 'hybrid-pill';
  const model = getActiveModel();
  const hp = modelPickForMatch(match, data);
  if (!hp) {
    wrap.hidden = true;
    return wrap;
  }
  const sideLabel = hp.side === 'team_a' ? match.team_a
    : hp.side === 'team_b' ? match.team_b
    : 'Draw';
  const label = `${MODEL_LABELS[model] || 'Model'} pick`;
  const srcMap = {
    stack: 'ML J5L+DT blend (learning)',
    hybrid: hp.source === 'hybrid' ? 'hybrid + live match market' : 'hybrid (⅓ J5L+DT+Markets)',
    j5l: 'J5L composite',
    dt: 'DT rating',
    kalshi: 'market win odds',
  };
  wrap.innerHTML = `
    <span class="hybrid-pill-label">${escapeHtml(label)}</span>
    <strong>${escapeHtml(sideLabel)}</strong>
    <span class="hybrid-pill-pct">${hp.prob_pct}%</span>
    <span class="muted hybrid-pill-src">${escapeHtml(srcMap[model] || '')}</span>
  `;

  // R20: conformal "safe set" — the calibrated outcome set that contains the
  // real result ~85% of the time (data/conformal.json, re-fit each cron). Only
  // rendered for the stack model (the calibration is over its predictions) and
  // only when the calibration file + a stack triplet exist.
  if (model === 'stack') {
    const thr = conformalThreshold(data?.conformal);
    const triplet = stackMatchTriplet(data, match.team_a, match.team_b);
    if (thr != null && triplet) {
      const set = predictionSet(triplet, thr);
      const lvl = Math.round(parseFloat(data.conformal.display_level || '0.85') * 100);
      const line = document.createElement('div');
      line.className = 'muted safe-set-line';
      line.setAttribute('data-testid', 'safe-set');
      line.textContent = `Safe set (${lvl}%): ${safeSetLabel(set, match.team_a, match.team_b)}`;
      wrap.appendChild(line);
    }
  }
  return wrap;
}
