/* play-view.js — R6 T2: the single mandatory funnel for making a bracket.
   Stages:
     1. Group orders 1–4, one group per screen, A→L
     2. Rank the 8 best 3rd-place teams (Sortable for reorder)
     3. Horizontal knockout incl. 3rd-place game + Final, tap-to-advance

   Persistence reuses existing localStorage keys verbatim
   (wc26.grouppicks.<id> and wc26.mybrackets.<id>) — no new schema. */

import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { helpCard, HELP_COPY } from '../components/help-card.js';
import { openPodiumModal } from '../components/podium-modal.js';
import {
  emptyPicks,
  loadGroupPicks,
  persistGroupPicks,
  setRankForGroup,
  clearRankForGroup,
  toggleBestThird,
  reorderBestThirds,
  isStage1Complete,
  isStage2Complete,
  listThirdsCandidates,
  stage1WhatsLeft,
  stage2WhatsLeft,
  suggestGroupOrderFromProjected,
  GROUP_LETTERS,
  REQUIRED_THIRDS,
} from '../group-picks-builder.js';
import {
  loadBracketDraft,
  persistBracketDraft,
  buildR32Seeding,
  computeRounds,
  getPickFor,
  setPickFor,
  clearDownstream,
  getThirdPlaceMatch,
  getThirdPlacePick,
  setThirdPlacePick,
  isStage3Complete,
  knockoutWhatsLeft,
  getChampion,
  getRunnerUp,
  ROUND_LABELS,
  ROUND_POINTS,
  isSlotPlaceholder,
} from '../bracket-builder.js';
import { getCompetitionState } from '../competition.js';
import { normalizeGroupPredictions } from '../group-scoring.js';
import { computeGroupStandings } from '../bracket-resolver.js';

const STAGES = ['1', '2', '3'];

export function renderPlayView(root, data, params = {}) {
  root.innerHTML = '';
  const stage = STAGES.includes(params.stage) ? params.stage : '1';
  const comp = getCompetitionState();
  const poolId = comp?.activeGroup?.id || null;

  // Help card
  root.appendChild(helpCard({ ...HELP_COPY.play, persistKey: 'play' }));

  // Pool selector + progress chips
  root.appendChild(renderHeader(comp, poolId, stage, data));

  // R11: Quick-start CTA when group stage is complete and the user has no
  // Stage-1 picks yet. Drops them straight onto Stage 3 with the bracket
  // pre-seeded from actual results.
  if (stage === '1' && groupStageIsComplete(data)) {
    const hasStage1 = isStage1Complete(loadGroupPicks(poolId));
    if (!hasStage1) {
      root.appendChild(renderLateJoinerCta(data, poolId));
    }
  }

  // Stage container
  const stageRoot = document.createElement('section');
  stageRoot.className = 'pw-stage-root';
  stageRoot.setAttribute('data-testid', `play-stage-${stage}`);
  root.appendChild(stageRoot);

  if (stage === '1') renderStage1(stageRoot, data, poolId, params);
  else if (stage === '2') renderStage2(stageRoot, data, poolId);
  else renderStage3(stageRoot, data, poolId);

  // Sticky submit bar
  root.appendChild(renderSubmitBar(data, poolId, comp));
}

/* -- Header ---------------------------------------------------------------- */

function renderHeader(comp, poolId, stage, data) {
  const wrap = document.createElement('section');
  wrap.className = 'pw-play-head';
  const stageLabel = stage === '1' ? 'Group standings' : stage === '2' ? 'Best 3rd-place teams' : 'Knockout bracket';
  wrap.innerHTML = `
    <div class="pw-stage-strip" role="tablist" aria-label="Play stages">
      ${STAGES.map((s) => `
        <button role="tab" class="pw-stage-chip ${s === stage ? 'is-active' : ''}" data-stage="${s}" aria-current="${s === stage ? 'page' : 'false'}" data-testid="stage-chip-${s}">
          <span class="pw-stage-num">${s}</span>
          <span class="pw-stage-label">${s === '1' ? 'Groups' : s === '2' ? '3rd places' : 'Knockout'}</span>
        </button>
      `).join('')}
    </div>
    <h2 class="pw-stage-heading">Stage ${stage} · ${stageLabel}</h2>
    <p class="muted" style="font-size:12px; margin:0;">Active pool: <strong>${escapeHtml(comp?.activeGroup?.name || 'Local (not in a pool)')}</strong> · Everyone pool is always included.</p>
  `;
  wrap.querySelectorAll('[data-stage]').forEach((b) => {
    b.addEventListener('click', () => setRoute('play', { stage: b.dataset.stage }));
  });
  return wrap;
}

/* -- Stage 1 --------------------------------------------------------------- */

function renderStage1(host, data, poolId, params) {
  let picks = loadGroupPicks(poolId);
  if (!picks.groups) picks = emptyPicks();
  // Pick group from params, or first incomplete group
  const requestedGroup = (params.group || '').toUpperCase();
  let letter = GROUP_LETTERS.includes(requestedGroup) ? requestedGroup : firstIncompleteGroup(picks) || 'A';

  function repaint() {
    host.innerHTML = '';
    host.appendChild(renderGroupProgress(picks, letter));
    host.appendChild(renderGroupCard(data, picks, letter));
    host.appendChild(renderGroupNav(letter));
  }

  function renderGroupProgress(picks, currentLetter) {
    const strip = document.createElement('div');
    strip.className = 'pw-group-progress';
    strip.setAttribute('aria-label', 'Group progress');
    const done = GROUP_LETTERS.filter((l) => Array.isArray(picks?.groups?.[l]) && picks.groups[l].every(Boolean));
    strip.innerHTML = `
      <div class="pw-group-progress-chips">
        ${GROUP_LETTERS.map((l) => `
          <button class="pw-group-chip ${done.includes(l) ? 'is-done' : ''} ${l === currentLetter ? 'is-current' : ''}" data-go="${l}" aria-label="Group ${l}${done.includes(l) ? ', complete' : ''}">${l}</button>
        `).join('')}
      </div>
      <div class="muted pw-group-counter">${done.length} of 12 complete</div>
    `;
    strip.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => {
        letter = b.dataset.go;
        repaint();
      });
    });
    return strip;
  }

  function renderGroupCard(data, picks, letter) {
    const card = document.createElement('div');
    card.className = 'pw-group-card';
    card.setAttribute('data-testid', `play-group-${letter}`);
    const teams = data?.groupMatchups?.[letter]?.teams || [];
    const order = picks.groups[letter] || [null, null, null, null];

    function rankFor(team) {
      const i = order.indexOf(team);
      return i >= 0 ? i + 1 : null;
    }

    card.innerHTML = `
      <h3 class="pw-group-title">Group ${letter}</h3>
      <p class="muted" style="font-size:12px; margin:0 0 12px;">Tap teams in order from 1st to 4th. Tap again to clear.</p>
      <div class="pw-team-grid">
        ${teams.map((t) => {
          const r = rankFor(t);
          return `
            <button class="pw-team-tile ${r ? `is-ranked rank-${r}` : ''}" data-team="${escapeHtml(t)}" data-testid="team-tile-${letter}-${escapeHtml(t.replace(/\s+/g,'-'))}" aria-pressed="${r ? 'true' : 'false'}">
              <span class="pw-team-flag" aria-hidden="true">${flagFor(t)}</span>
              <span class="pw-team-name">${escapeHtml(t)}</span>
              ${r ? `<span class="pw-team-rank">${ordinal(r)}</span>` : '<span class="pw-team-rank-empty" aria-hidden="true">·</span>'}
            </button>
          `;
        }).join('')}
      </div>
      <div class="pw-group-actions">
        <button class="pick-btn pick-btn-secondary" data-action="suggest">Suggest from model</button>
        <button class="pick-btn pick-btn-secondary" data-action="clear">Clear group</button>
      </div>
    `;

    card.querySelectorAll('[data-team]').forEach((tile) => {
      tile.addEventListener('click', () => {
        const team = tile.dataset.team;
        const existing = rankFor(team);
        if (existing) {
          picks = clearRankForGroup(picks, letter, existing);
        } else {
          const nextPlace = nextEmptyPlace(picks.groups[letter] || []);
          if (nextPlace) picks = setRankForGroup(picks, letter, nextPlace, team);
        }
        persistGroupPicks(poolId, picks);
        repaint();
        window.dispatchEvent(new CustomEvent('play:picks-changed'));
      });
    });

    card.querySelector('[data-action="suggest"]').addEventListener('click', () => {
      const suggested = suggestGroupOrderFromProjected(data, letter);
      for (let i = 0; i < 4; i++) {
        if (suggested[i]) picks = setRankForGroup(picks, letter, i + 1, suggested[i]);
      }
      persistGroupPicks(poolId, picks);
      repaint();
      window.dispatchEvent(new CustomEvent('play:picks-changed'));
    });
    card.querySelector('[data-action="clear"]').addEventListener('click', () => {
      for (let p = 1; p <= 4; p++) picks = clearRankForGroup(picks, letter, p);
      persistGroupPicks(poolId, picks);
      repaint();
      window.dispatchEvent(new CustomEvent('play:picks-changed'));
    });

    return card;
  }

  function renderGroupNav(currentLetter) {
    const nav = document.createElement('div');
    nav.className = 'pw-group-nav';
    const idx = GROUP_LETTERS.indexOf(currentLetter);
    const prev = idx > 0 ? GROUP_LETTERS[idx - 1] : null;
    const next = idx < GROUP_LETTERS.length - 1 ? GROUP_LETTERS[idx + 1] : null;
    // R7 QA fix: on the last group ("L") the previous code rendered
    // "Stage 1 complete →" but disabled the button (because `next` was null),
    // so the click handler bailed before navigating. Now the next-button is
    // always enabled if either (a) there is a next group, or (b) every group
    // is complete and we're ready for Stage 2. Stage 2 navigation also
    // works from any group as long as Stage 1 is complete.
    const stage1Done = isStage1Complete(picks);
    const isLast = !next;
    const nextEnabled = next != null || stage1Done;
    const nextLabel = isLast
      ? (stage1Done ? 'Continue to Stage 2 →' : 'Finish ranking to continue →')
      : 'Next group →';
    nav.innerHTML = `
      <button class="pick-btn pick-btn-secondary" ${prev ? '' : 'disabled'} data-go="${prev || ''}" data-testid="play-prev-group">← Prev</button>
      <button class="pick-btn" ${nextEnabled ? '' : 'disabled'} data-go="${next || (stage1Done ? '__stage2__' : '')}" data-testid="play-next-group">${nextLabel}</button>
    `;
    nav.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        const go = b.dataset.go;
        if (go === '__stage2__') {
          setRoute('play', { stage: '2' });
        } else if (go && GROUP_LETTERS.includes(go)) {
          letter = go;
          repaint();
        }
      });
    });
    return nav;
  }

  repaint();
}

/* -- Stage 2 --------------------------------------------------------------- */

function renderStage2(host, data, poolId) {
  let picks = loadGroupPicks(poolId);
  if (!picks.groups) picks = emptyPicks();

  function repaint() {
    host.innerHTML = '';
    const candidates = listThirdsCandidates(picks);
    const ranked = picks.best_thirds || [];

    const wrap = document.createElement('div');
    wrap.className = 'pw-stage2';
    wrap.innerHTML = `
      <p class="muted pw-stage2-note">FIFA assigns 3rd-place R32 slots by group combination (points → goal difference → goals for → fair play → FIFA ranking). Rank your top 8 to set your Round of 32 seeding.</p>
      <div class="pw-stage2-counter" data-testid="thirds-counter">${ranked.length}/${REQUIRED_THIRDS}</div>
      <h3 class="pw-stage2-heading">Candidates (each group's 3rd)</h3>
      <div class="pw-cand-grid" data-testid="thirds-candidates"></div>
      <h3 class="pw-stage2-heading">Your top ${REQUIRED_THIRDS} (drag to reorder)</h3>
      <ol class="pw-thirds-list" id="pw-thirds-list" data-testid="thirds-ranked"></ol>
    `;
    const candGrid = wrap.querySelector('.pw-cand-grid');
    for (const c of candidates) {
      const rankIdx = ranked.indexOf(c.team);
      const tile = document.createElement('button');
      tile.className = `pw-cand-tile ${rankIdx >= 0 ? 'is-ranked' : ''}`;
      tile.setAttribute('data-testid', `third-cand-${c.team.replace(/\s+/g,'-')}`);
      tile.disabled = rankIdx < 0 && ranked.length >= REQUIRED_THIRDS;
      tile.innerHTML = `
        <span class="pw-cand-grp muted">${c.group}</span>
        <span class="pw-cand-flag" aria-hidden="true">${flagFor(c.team)}</span>
        <span class="pw-cand-name">${escapeHtml(c.team)}</span>
        <span class="pw-cand-rank">${rankIdx >= 0 ? rankIdx + 1 : '+'}</span>
      `;
      tile.addEventListener('click', () => {
        picks = toggleBestThird(picks, c.team);
        persistGroupPicks(poolId, picks);
        repaint();
        window.dispatchEvent(new CustomEvent('play:picks-changed'));
      });
      candGrid.appendChild(tile);
    }
    const list = wrap.querySelector('#pw-thirds-list');
    ranked.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'pw-third-li';
      li.dataset.team = t;
      li.innerHTML = `
        <span class="pw-third-rank">${i + 1}</span>
        <span class="pw-third-flag" aria-hidden="true">${flagFor(t)}</span>
        <span class="pw-third-name">${escapeHtml(t)}</span>
        <button type="button" class="pw-third-remove" aria-label="Remove ${escapeHtml(t)}">×</button>
      `;
      li.querySelector('.pw-third-remove').addEventListener('click', () => {
        picks = toggleBestThird(picks, t);
        persistGroupPicks(poolId, picks);
        repaint();
        window.dispatchEvent(new CustomEvent('play:picks-changed'));
      });
      list.appendChild(li);
    });
    host.appendChild(wrap);
    initSortable(list, (newOrder) => {
      // Compute reorder pairs
      const cur = [...picks.best_thirds];
      const reordered = newOrder.map((t) => cur.find((x) => x === t)).filter(Boolean);
      picks.best_thirds = reordered;
      persistGroupPicks(poolId, picks);
      repaint();
      window.dispatchEvent(new CustomEvent('play:picks-changed'));
    });

    // Stage nav
    const nav = document.createElement('div');
    nav.className = 'pw-group-nav';
    nav.innerHTML = `
      <button class="pick-btn pick-btn-secondary" data-go="1" data-testid="play-back-to-1">← Back to Stage 1</button>
      <button class="pick-btn" data-go="3" ${isStage2Complete(picks) ? '' : 'disabled'} data-testid="play-next-stage3">Next: Knockout →</button>
    `;
    nav.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        setRoute('play', { stage: b.dataset.go });
      });
    });
    host.appendChild(nav);
  }
  repaint();
}

async function initSortable(list, onChange) {
  if (!list || !list.children.length) return;
  try {
    const mod = await import('https://esm.sh/sortablejs@1.15.2');
    const Sortable = mod.default || mod.Sortable;
    Sortable.create(list, {
      animation: 150,
      onEnd: () => {
        const order = Array.from(list.children).map((li) => li.dataset.team);
        onChange(order);
      },
    });
  } catch {
    // Fallback: keep list static if the module fails to load (e.g. offline).
  }
}

/* -- Stage 3 --------------------------------------------------------------- */

function renderStage3(host, data, poolId) {
  // R6 QA: every re-paint must start from a clean host, otherwise the
  // tree appends a new copy on every tap and the page balloons. Wipe
  // before drawing.
  host.replaceChildren();

  const draft = loadBracketDraft(poolId);
  const groupPicks = normalizeGroupPredictions(loadGroupPicks(poolId));
  const r32 = buildR32Seeding(data, { userPicks: groupPicks });
  const rounds = computeRounds(r32, draft);

  // Status: if user hasn't finished Stage 1+2, surface that prominently
  if (!isStage1Complete(loadGroupPicks(poolId)) || !isStage2Complete(loadGroupPicks(poolId))) {
    const banner = document.createElement('div');
    banner.className = 'home-card pw-stage3-banner';
    banner.innerHTML = `
      <h3 style="margin: 0 0 6px;">Finish Stage 1 + 2 first</h3>
      <p class="muted" style="font-size:12px; margin:0;">Your bracket fills in automatically once your group orders and best-thirds ranking are complete. You can still preview below.</p>
    `;
    host.appendChild(banner);
  }

  const tree = document.createElement('div');
  tree.className = 'pw-bracket-tree';
  tree.setAttribute('data-testid', 'play-bracket-tree');
  // R10 a11y: keyboard users couldn't horizontally scroll the bracket tree.
  // tabindex=0 + role=region + aria-label makes it focusable; arrow keys
  // pan the inner scrollX.
  tree.tabIndex = 0;
  tree.setAttribute('role', 'region');
  tree.setAttribute('aria-label', 'Knockout bracket — use left/right arrow keys to scroll between rounds');
  tree.addEventListener('keydown', (e) => {
    const step = 220;
    if (e.key === 'ArrowRight') { tree.scrollLeft += step; e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { tree.scrollLeft -= step; e.preventDefault(); }
    else if (e.key === 'Home') { tree.scrollLeft = 0; e.preventDefault(); }
    else if (e.key === 'End') { tree.scrollLeft = tree.scrollWidth; e.preventDefault(); }
  });
  for (const round of rounds) {
    const col = document.createElement('div');
    col.className = 'pw-bracket-col';
    col.dataset.round = round.key;
    col.innerHTML = `<h3 class="pw-bracket-col-head">${escapeHtml(round.key)} <span class="muted">${ROUND_POINTS[round.key] || 0}pt</span></h3>`;
    for (const m of round.matches) {
      const card = document.createElement('div');
      card.className = 'pw-bracket-card';
      card.setAttribute('data-match', String(m.match_number));
      card.setAttribute('data-testid', `bracket-slot-${m.match_number}`);
      const aLocked = !m.team_a || isSlotPlaceholder(m.team_a);
      const bLocked = !m.team_b || isSlotPlaceholder(m.team_b);
      const aPicked = m.pick === m.team_a;
      const bPicked = m.pick === m.team_b;
      card.innerHTML = `
        <button type="button" class="pw-bracket-side ${aPicked ? 'is-picked' : ''}" ${aLocked ? 'disabled' : ''} data-pick="a">
          <span class="pw-bracket-flag" aria-hidden="true">${aLocked ? '·' : flagFor(m.team_a)}</span>
          <span class="pw-bracket-name">${escapeHtml(m.team_a || 'Waiting…')}</span>
        </button>
        <button type="button" class="pw-bracket-side ${bPicked ? 'is-picked' : ''}" ${bLocked ? 'disabled' : ''} data-pick="b">
          <span class="pw-bracket-flag" aria-hidden="true">${bLocked ? '·' : flagFor(m.team_b)}</span>
          <span class="pw-bracket-name">${escapeHtml(m.team_b || 'Waiting…')}</span>
        </button>
      `;
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pick]');
        if (!btn || btn.disabled) return;
        const choice = btn.dataset.pick === 'a' ? m.team_a : m.team_b;
        const pair = { team_a: m.team_a, team_b: m.team_b };
        if (getPickFor(draft, m.match_number) === choice) {
          setPickFor(draft, m.match_number, null);
        } else {
          setPickFor(draft, m.match_number, choice, pair);
        }
        clearDownstream(draft, m.match_number);
        persistBracketDraft(poolId, draft);
        // R6 QA: notify the sticky submit bar that picks changed; without this
        // the "What's left" checklist + Submit-enabled state stays stale.
        window.dispatchEvent(new CustomEvent('play:picks-changed'));
        renderStage3(host.parentElement.querySelector('.pw-stage-root') || host, data, poolId);
      });
      col.appendChild(card);
    }
    tree.appendChild(col);
  }
  host.appendChild(tree);

  // 3rd-place game (match #103)
  host.appendChild(renderThirdPlaceCard(data, poolId, draft, rounds));

  // Stage nav
  const nav = document.createElement('div');
  nav.className = 'pw-group-nav';
  nav.innerHTML = `
    <button class="pick-btn pick-btn-secondary" data-go="2" data-testid="play-back-to-2">← Back to Stage 2</button>
    <span class="muted" style="font-size: 12px;">Submit from the bar below when everything's decided.</span>
  `;
  nav.querySelector('[data-go]').addEventListener('click', () => setRoute('play', { stage: '2' }));
  host.appendChild(nav);
}

function renderThirdPlaceCard(data, poolId, draft, rounds) {
  const wrap = document.createElement('div');
  wrap.className = 'home-card pw-third-place';
  wrap.setAttribute('data-testid', 'play-third-place');
  // Semifinal losers: the team in each SF match that *wasn't* picked
  const sf = rounds.find((r) => r.key === 'SF');
  if (!sf) return wrap;
  const losers = sf.matches.map((m) => {
    if (!m.pick || !m.team_a || !m.team_b) return null;
    return m.team_a === m.pick ? m.team_b : m.team_a;
  }).filter(Boolean);
  if (losers.length < 2) {
    wrap.innerHTML = `
      <h3 style="margin: 0 0 6px;">3rd-place game</h3>
      <p class="muted" style="font-size:12px; margin:0;">Decide both semifinals first — the losers play for 3rd place.</p>
    `;
    return wrap;
  }
  const [a, b] = losers;
  const pick = getThirdPlacePick(draft);
  wrap.innerHTML = `
    <h3 style="margin: 0 0 6px;">3rd-place game (match #103)</h3>
    <p class="muted" style="font-size:12px; margin:0 0 8px;">Who finishes third?</p>
    <div class="pw-bracket-card pw-third-place-card">
      <button type="button" class="pw-bracket-side ${pick === a ? 'is-picked' : ''}" data-pick="a">
        <span class="pw-bracket-flag" aria-hidden="true">${flagFor(a)}</span>
        <span class="pw-bracket-name">${escapeHtml(a)}</span>
      </button>
      <button type="button" class="pw-bracket-side ${pick === b ? 'is-picked' : ''}" data-pick="b">
        <span class="pw-bracket-flag" aria-hidden="true">${flagFor(b)}</span>
        <span class="pw-bracket-name">${escapeHtml(b)}</span>
      </button>
    </div>
  `;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const chosen = btn.dataset.pick === 'a' ? a : b;
    if (pick === chosen) setThirdPlacePick(draft, null);
    else setThirdPlacePick(draft, chosen, { team_a: a, team_b: b });
    persistBracketDraft(poolId, draft);
    window.dispatchEvent(new CustomEvent('play:picks-changed'));
    setRoute('play', { stage: '3' }); // repaint
  });
  return wrap;
}

/* -- Submit bar (sticky, computed live) ------------------------------------ */

function renderSubmitBar(data, poolId, comp) {
  const wrap = document.createElement('section');
  wrap.className = 'pw-submit-bar';
  wrap.setAttribute('data-testid', 'play-submit-bar');

  function compute() {
    const picks = loadGroupPicks(poolId);
    const draft = loadBracketDraft(poolId);
    const groupPicks = normalizeGroupPredictions(picks);
    const r32 = buildR32Seeding(data, { userPicks: groupPicks });
    const rounds = computeRounds(r32, draft);

    // R11: the bracket is submittable when every knockout slot is decided,
    // regardless of whether Stage 1+2 were predicted by the user.
    // buildR32Seeding now resolves slots from actual results when available,
    // so late-joiners who skip Stages 1+2 still get a fillable R32.
    //
    // Stage 1+2 status remains surfaced as INFO so users see scoring
    // opportunities (predict correctly = +3/+2/+1 per group) — but it
    // doesn't gate submit.
    const s1 = stage1WhatsLeft(picks);
    const s2 = stage2WhatsLeft(picks);
    const koLeft = knockoutWhatsLeft(rounds, draft);
    // Verify R32 actually has 16 real teams (not still showing 1A/2B/3 ABCDF)
    const r32Placeholders = rounds[0].matches.filter(
      (m) => (!m.team_a || /^\d[A-L]$|^3 [A-L]+$/.test(m.team_a)) ||
             (!m.team_b || /^\d[A-L]$|^3 [A-L]+$/.test(m.team_b))
    ).length;

    const blockers = [];
    if (r32Placeholders > 0) {
      // Bracket isn't fully resolvable yet — surface the missing inputs.
      if (s1) blockers.push(s1);
      if (s2) blockers.push(s2);
    }
    for (const l of koLeft) blockers.push(`Stage 3: ${l}`);

    const info = [];
    if (r32Placeholders === 0) {
      // Bracket is resolvable; treat Stage 1+2 status as advisory.
      if (s1) info.push(`${s1} (predictions are optional once group results land)`);
      if (s2) info.push(`${s2} (predictions are optional once group results land)`);
    }

    return {
      blockers,
      info,
      canSubmit: blockers.length === 0,
      rounds,
      draft,
    };
  }

  function paint() {
    const { blockers, info, canSubmit, rounds, draft } = compute();
    const locked = comp?.lockState?.bracketLocked;
    const allGreen = blockers.length === 0;
    wrap.innerHTML = `
      <div class="pw-submit-card">
        <div class="pw-submit-checklist" aria-live="polite">
          <strong style="display:block; margin-bottom: 6px;">${allGreen ? 'Ready' : "What's left"}</strong>
          ${allGreen
            ? `<span class="pw-submit-allgreen">All set — ready to submit.</span>${info.length ? `<ul class="pw-submit-info">${info.slice(0,3).map((l) => `<li class="muted" style="font-size:11px;">${escapeHtml(l)}</li>`).join('')}</ul>` : ''}`
            : `<ul>${blockers.slice(0, 6).map((l) => `<li>${escapeHtml(l)}</li>`).join('')}${blockers.length > 6 ? `<li class="muted">+${blockers.length - 6} more</li>` : ''}</ul>`}
        </div>
        <button class="pick-btn pw-submit-btn" id="pw-submit-btn" ${canSubmit && !locked ? '' : 'disabled'} data-testid="play-submit">${locked ? 'Bracket locked' : (canSubmit ? 'Submit bracket' : 'Submit')}</button>
      </div>
    `;
    wrap.querySelector('#pw-submit-btn').addEventListener('click', async () => {
      if (!canSubmit || locked) return;
      const champion = getChampion(rounds);
      const runnerUp = getRunnerUp(rounds);
      const third = getThirdPlacePick(draft);
      openPodiumModal({
        first: champion,
        second: runnerUp,
        third,
        label: comp?.activeGroup?.name ? `Submitting to ${comp.activeGroup.name} + Everyone` : 'Submitting to Everyone',
        picks: draft.picks,
        onSubmit: async () => {
          await submitBracket(data, poolId);
        },
      });
    });
  }

  paint();
  window.addEventListener('play:picks-changed', paint);
  return wrap;
}

async function submitBracket(data, poolId) {
  // Lazy import so node tests don't pull supabase.
  const comp = await import('../competition.js');
  // Save group picks first (so server can pick them up before scoring the bracket)
  try { await comp.saveGroupPredictionsForActiveGroup(); } catch (err) { console.warn('[play] group save failed', err); }
  try { await comp.saveBracketForActiveGroup(data); } catch (err) { console.warn('[play] bracket save failed', err); }
  // Confetti runs from the podium modal. Notify other views.
  window.dispatchEvent(new CustomEvent('play:submitted', { detail: { poolId } }));
}

/* -- Utilities ------------------------------------------------------------- */

function firstIncompleteGroup(picks) {
  for (const l of GROUP_LETTERS) {
    const order = picks?.groups?.[l];
    if (!Array.isArray(order) || order.some((t) => !t)) return l;
  }
  return null;
}

function nextEmptyPlace(order) {
  for (let i = 0; i < 4; i++) if (!order[i]) return i + 1;
  return null;
}

// R11: tell whether the group stage is fully played, so the late-joiner
// CTA only appears when the bracket can actually be auto-seeded.
function groupStageIsComplete(data) {
  const letters = Object.keys(data?.groupMatchups || {});
  if (!letters.length) return false;
  for (const l of letters) {
    const s = computeGroupStandings(data, l);
    if (!Array.isArray(s) || s.length < 4) return false;
  }
  return true;
}

function renderLateJoinerCta(data, poolId) {
  const card = document.createElement('section');
  card.className = 'home-card pw-late-joiner-cta';
  card.setAttribute('data-testid', 'late-joiner-cta');
  card.innerHTML = `
    <h2 class="home-card-title">Group stage is over — skip straight to the bracket</h2>
    <p class="muted" style="font-size: 13px; margin: 0 0 12px;">
      Your Round of 32 is auto-filled from the real results. Just pick winners through to the Final.
    </p>
    <div style="display:flex; gap:8px; flex-wrap: wrap;">
      <button class="pick-btn" data-action="quick-start">Start your bracket →</button>
      <button class="pick-btn pick-btn-secondary" data-action="predict-anyway">Predict groups anyway</button>
    </div>
  `;
  card.querySelector('[data-action="quick-start"]').addEventListener('click', () => {
    setRoute('play', { stage: '3' });
  });
  card.querySelector('[data-action="predict-anyway"]').addEventListener('click', () => {
    // Dismiss the CTA by storing a flag; user already on Stage 1, just hide
    try { localStorage.setItem('wc26.lateJoinerCtaDismissed', '1'); } catch {}
    card.remove();
  });
  // Honor dismissal
  try {
    if (localStorage.getItem('wc26.lateJoinerCtaDismissed') === '1') {
      card.hidden = true;
    }
  } catch {}
  return card;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
