/* my-brackets-view.js — interactive bracket builder + submit-to-group.
   Builds an R32→R16→QF→SF→Final tree. The user taps winners; the next round's
   slots auto-populate. Picks are stored in a dedicated localStorage draft keyed
   by group (or "local" default). Submit upserts to Supabase group_brackets.
*/
import { setRoute } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import {
  getCompetitionState,
  saveBracketForActiveGroup,
  setActiveGroup,
  fetchLeaderboard,
  isSupabaseConfigured,
  fetchMyGroupPredictions,
  getCachedGroupPredictions,
} from '../competition.js';
import { scoreBracketWeighted, WEIGHTED_ROUND_POINTS, MAX_WEIGHTED_SCORE } from '../competition-scoring.js';
import { normalizeGroupPredictions } from '../group-scoring.js';
import { buildAutofill, mergeAutofillIntoBracket, FILL_SOURCES } from '../bracket-autofill.js';
import { createShareLink, tryShareViaNavigator } from '../share-bracket.js';
import { helpCard, HELP_COPY } from '../components/help-card.js';

const LS_KEY_PREFIX = 'wc26.mybrackets.';
const ROUND_LABELS = ['R32', 'R16', 'QF', 'SF', 'Final'];

export function renderMyBracketsView(root, data) {
  if (!data) {
    root.innerHTML = '<p class="loading">Loading bracket builder…</p>';
    return;
  }
  // Capture scroll position so re-renders triggered by tap-to-pick don't yank
  // the user back to the top of the page.
  const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  root.innerHTML = '';
  // R6: help card at the top — spec §4 verbatim
  root.appendChild(helpCard({ ...HELP_COPY.myBrackets, persistKey: 'my-brackets' }));

  const comp = getCompetitionState();
  if (!isSupabaseConfigured()) {
    root.appendChild(notice("This build has no cloud login. You can still build a bracket locally — picks save to this device."));
  }

  // Fire-and-forget: pull this user's group_predictions for the active pool
  // into the in-memory cache. The first render reads from localStorage; once
  // this resolves, a state:change will trigger a re-render using the server
  // picks. Cross-device R32 auto-seed without making the view async.
  if (comp?.user && comp?.activeGroup?.id && !getCachedGroupPredictions()) {
    fetchMyGroupPredictions().then((rec) => {
      if (rec?.picks) {
        // Force a re-render so the R32 seeding picks up the freshly cached picks.
        try { window.dispatchEvent(new CustomEvent('state:change')); } catch {}
      }
    }).catch(() => {});
  }

  // Top: group selector + draft selector
  root.appendChild(renderHeader(comp));
  root.appendChild(renderProgressBar(0, 31));

  // Lock banner
  if (comp.lockState?.bracketLocked) {
    const lock = document.createElement('div');
    lock.className = 'bb-locked-banner';
    lock.textContent = `Bracket locked: ${comp.lockState.phase}. You can review picks but not change them.`;
    root.appendChild(lock);
  }

  // Build the bracket from current draft state
  const draftKey = currentDraftKey(comp);
  const bracket = loadBracket(draftKey);

  // R32 seeding: take from data.scheduleFull where match_number 73..88
  const seedR32 = buildR32Seeding(data, bracket);
  if (!seedR32.length) {
    root.appendChild(emptyCard("Bracket hasn't been seeded yet — waiting on group stage results to determine R32 matchups. You can still pre-pick teams once seeded."));
    return;
  }

  const rounds = computeRounds(seedR32, bracket);
  // Refresh progress
  const totalPicks = rounds.reduce((acc, r) => acc + r.matches.filter((m) => m.pick).length, 0);
  const totalSlots = 31;
  root.querySelector('.bb-progress .bb-fill').style.width = `${Math.round((totalPicks / totalSlots) * 100)}%`;
  root.querySelector('.bb-progress .bb-num').textContent = `${totalPicks} / ${totalSlots}`;

  // Render each round
  for (const round of rounds) {
    root.appendChild(renderRound(round, bracket, draftKey, () => {
      // re-render on pick changes
      renderMyBracketsView(root, data);
    }, data, comp));
  }

  // Projected weighted points
  const proj = renderProjection(rounds, data);
  root.appendChild(proj);

  // Restore scroll position after the DOM rebuild so picking doesn't yank
  // the user back to the top.
  if (scrollY > 0) {
    requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
  }

  // Submit bar
  root.appendChild(renderSubmitBar(comp, totalPicks, totalSlots, async (msgEl, btn) => {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      msgEl.textContent = '';
      const score = await saveBracketForActiveGroup(data);
      msgEl.textContent = `Bracket saved. Current score: ${score} pts. Edit and re-submit anytime until lock.`;
      // H5: celebrate the submit.
      try {
        const { showConfetti } = await import('../confetti.js');
        showConfetti();
      } catch {}
    } catch (err) {
      msgEl.textContent = err.message || 'Could not submit bracket.';
      msgEl.setAttribute('role', 'alert');
    } finally {
      btn.disabled = false;
      btn.setAttribute('aria-busy', 'false');
    }
  }));
}

function renderHeader(comp) {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  const groups = comp.groups || [];
  const activeId = comp.activeGroup?.id || '';
  const groupOptions = groups.length
    ? `<select id="mb-group-select" class="auth-input"><option value="">Local (not submitted to a pool)</option>${groups.map((g) => `<option value="${escapeHtml(g.id)}" ${activeId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}</select>`
    : '<p class="muted">No pools yet. <a href="#/pools">Browse public pools</a> or <a href="#/create-group">create your own</a>.</p>';
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">Build & submit bracket</h2>
      <label for="mb-group-select" class="muted" style="font-size:12px;">Submitting to</label>
      ${groupOptions}
      <p class="muted" style="font-size:12px; margin: 8px 0 0;">Manage pools on the <a href="#/pools">Pools tab</a>.</p>

      <h3 style="margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted);">Auto-fill empty slots</h3>
      <div class="mb-autofill-grid">
        <button class="pick-btn pick-btn-secondary" data-autofill="model">Use Model</button>
        <button class="pick-btn pick-btn-secondary" data-autofill="kalshi">Use Kalshi</button>
        <button class="pick-btn pick-btn-secondary" data-autofill="hybrid">50/50 Hybrid</button>
        <button class="pick-btn pick-btn-secondary" data-autofill="consensus">Public Consensus</button>
      </div>
      <label class="mb-autofill-overwrite muted">
        <input type="checkbox" id="mb-autofill-overwrite"> Overwrite my current picks
      </label>
      <p id="mb-autofill-msg" class="muted" style="font-size:12px; margin: 6px 0 0;" role="status" aria-live="polite"></p>

      <h3 style="margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted);">Share your bracket</h3>
      <button class="pick-btn pick-btn-secondary" id="mb-share-btn" type="button">Share bracket</button>
      <p id="mb-share-msg" class="muted" style="font-size:12px; margin: 6px 0 0;" role="status" aria-live="polite"></p>
    </div>
  `;
  wrap.addEventListener('change', (e) => {
    if (e.target?.id === 'mb-group-select') {
      setActiveGroup(e.target.value);
    }
  });
  wrap.querySelector('#mb-share-btn')?.addEventListener('click', async () => {
    const msg = wrap.querySelector('#mb-share-msg');
    msg.textContent = 'Building link…';
    try {
      const { getCompetitionState } = await import('../competition.js');
      const compState = getCompetitionState();
      const draftKey = compState?.activeGroup?.id
        ? `wc26.mybrackets.${compState.activeGroup.id}`
        : 'wc26.mybrackets.local';
      const raw = localStorage.getItem(draftKey);
      const bracket = raw ? JSON.parse(raw) : { picks: {} };
      if (!Object.keys(bracket.picks || {}).length) {
        msg.textContent = 'Make some picks first.';
        return;
      }
      const url = await createShareLink(bracket.picks, { label: 'My WC26 Bracket' });
      const r = await tryShareViaNavigator(url, 'My WC26 Bracket');
      if (r === true) msg.textContent = 'Shared.';
      else if (r === 'clipboard') msg.textContent = `Copied: ${url}`;
      else msg.textContent = `Share link: ${url}`;
    } catch (err) {
      msg.textContent = err?.message || 'Share failed.';
    }
  });
  wrap.querySelectorAll('[data-autofill]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const source = e.currentTarget.dataset.autofill;
      const overwrite = !!wrap.querySelector('#mb-autofill-overwrite')?.checked;
      const msg = wrap.querySelector('#mb-autofill-msg');
      msg.textContent = 'Filling…';
      try {
        await runAutofill(source, overwrite);
        msg.textContent = `Filled with ${FILL_SOURCES[source]?.label || source}. Tap any slot to override.`;
      } catch (err) {
        msg.textContent = err.message || 'Auto-fill failed.';
      }
    });
  });
  return wrap;
}

async function runAutofill(source, overwrite) {
  // Pull current data from the global state (avoids passing it through every callsite)
  const { getState } = await import('../state.js');
  const data = getState()?.data;
  if (!data) throw new Error('Data not loaded yet.');

  let consensusMap = null;
  if (source === 'consensus') {
    consensusMap = await fetchConsensusMap();
    if (!consensusMap) {
      throw new Error('Public consensus unavailable. Falls back to model.');
    }
  }

  const autofill = buildAutofill(data, source, { consensusMap });
  if (!autofill.length) throw new Error('No matches to fill yet.');

  // Persist into the active pool's localStorage draft
  const comp = (await import('../competition.js')).getCompetitionState();
  const draftKey = comp?.activeGroup?.id
    ? `wc26.mybrackets.${comp.activeGroup.id}`
    : 'wc26.mybrackets.local';
  const raw = localStorage.getItem(draftKey);
  const bracket = raw ? JSON.parse(raw) : { picks: {} };
  bracket.picks = mergeAutofillIntoBracket(autofill, bracket.picks || {}, overwrite);
  localStorage.setItem(draftKey, JSON.stringify(bracket));
  // Trigger view re-render
  window.dispatchEvent(new CustomEvent('state:change'));
}

async function fetchConsensusMap() {
  // Aggregate picks across all PUBLIC pools' group_brackets.
  try {
    const { getCompetitionState } = await import('../competition.js');
    const state = getCompetitionState();
    if (!state?.client) return null;
    const { data: pools } = await state.client
      .from('groups')
      .select('id')
      .eq('visibility', 'public');
    if (!pools?.length) return {};
    const poolIds = pools.map((p) => p.id);
    const { data: brackets } = await state.client
      .from('group_brackets')
      .select('picks')
      .in('group_id', poolIds);
    if (!brackets) return {};
    const counts = {};
    for (const row of brackets) {
      for (const pick of (row.picks || [])) {
        if (!pick?.team_a || !pick?.team_b) continue;
        const team = pick.choice === 'team_a' ? pick.team_a : pick.choice === 'team_b' ? pick.team_b : null;
        if (!team) continue;
        counts[team] = (counts[team] || 0) + 1;
      }
    }
    return counts;
  } catch { return null; }
}

function renderProgressBar(done, total) {
  const wrap = document.createElement('div');
  wrap.className = 'bb-progress';
  wrap.innerHTML = `
    <div class="bb-track" aria-label="Picks progress"><div class="bb-fill" style="width:${Math.round((done/total)*100)}%"></div></div>
    <div class="bb-num">${done} / ${total}</div>
  `;
  return wrap;
}

function buildR32Seeding(data, bracket) {
  // R32 slot placeholders ("1A","2B","3 ABCDF") get resolved using the user's
  // group_predictions when available. Falls back to the projected order if
  // none submitted, so the bracket is always populated with real team names.
  const sf = data.scheduleFull || [];
  const r32 = sf.filter((m) => m.stage === 'round_of_32').sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
  if (r32.length !== 16) return [];

  const userPicks = normalizeGroupPredictions(loadUserGroupPicks());
  return r32.map((m) => ({
    match_number: m.match_number,
    team_a: resolveSlotFromUserPicks(m.team_a, userPicks, data),
    team_b: resolveSlotFromUserPicks(m.team_b, userPicks, data),
    kickoff_utc: m.kickoff_utc,
  }));
}

function loadUserGroupPicks() {
  // Resolution order for R32 seeding (cross-device for signed-in users):
  //   1. Server-cached group_predictions for active pool (fetched async on render)
  //   2. localStorage draft for active pool
  //   3. localStorage local draft
  const comp = getCompetitionState();
  // 1. Server cache
  const cached = getCachedGroupPredictions();
  if (cached) return cached;
  // 2 + 3. localStorage fallbacks
  try {
    const key = comp?.activeGroup?.id
      ? `wc26.grouppicks.${comp.activeGroup.id}`
      : 'wc26.grouppicks.local';
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
    const localRaw = localStorage.getItem('wc26.grouppicks.local');
    return localRaw ? JSON.parse(localRaw) : {};
  } catch { return {}; }
}

function resolveSlotFromUserPicks(slot, userPicks, data) {
  if (!slot || typeof slot !== 'string') return slot;

  // "1A" / "2B" → user's nth-place pick for group A/B
  const grp = slot.match(/^(\d)([A-L])$/);
  if (grp) {
    const place = parseInt(grp[1], 10);
    const letter = grp[2];
    const order = userPicks.groups?.[letter];
    if (Array.isArray(order) && order[place - 1]) return order[place - 1];
    return slot; // keep placeholder if no pick
  }

  // "3 ABCDF" → match the first of the user's best_thirds that belongs to
  // one of the listed groups (per FIFA's R32 seeding rules).
  const third = slot.match(/^3 ([A-L]+)$/);
  if (third) {
    const allowedGroups = new Set(third[1].split(''));
    const bestThirds = userPicks.best_thirds || [];
    for (const team of bestThirds) {
      const teamGroup = findTeamGroup(team, data);
      if (teamGroup && allowedGroups.has(teamGroup)) {
        return team;
      }
    }
    return slot;
  }

  return slot;
}

function findTeamGroup(team, data) {
  const gm = data?.groupMatchups || {};
  for (const [letter, info] of Object.entries(gm)) {
    if ((info.teams || []).includes(team)) return letter;
  }
  return null;
}

function computeRounds(r32, bracket) {
  const rounds = [{ key: 'R32', matches: r32.map((m) => ({ ...m, pick: getPickFor(bracket, m.match_number) })) }];
  for (let r = 1; r < ROUND_LABELS.length; r++) {
    const prev = rounds[r - 1];
    const matches = [];
    for (let i = 0; i < prev.matches.length; i += 2) {
      const a = prev.matches[i];
      const b = prev.matches[i + 1];
      // Match number for the next round: prev round's max + i/2 + 1 (loose, just used as a stable key)
      const matchNumber = nextRoundMatchNumber(prev.matches[0].match_number, r, i / 2);
      const aWinner = a && a.pick ? a.pick : null;
      const bWinner = b && b.pick ? b.pick : null;
      matches.push({
        match_number: matchNumber,
        team_a: aWinner,
        team_b: bWinner,
        kickoff_utc: null,
        pick: getPickFor(bracket, matchNumber),
        feeds_from: [a?.match_number, b?.match_number],
      });
    }
    rounds.push({ key: ROUND_LABELS[r], matches });
  }
  return rounds;
}

// Stable match number for derived round slots.
// Real FIFA numbering: R16 = 89-96, QF = 97-100, SF = 101-102, Final = 104.
function nextRoundMatchNumber(seedR32Min, roundIndex, pairIndex) {
  const ranges = [
    null,                  // R32 already has real numbers
    { base: 89, count: 8 },// R16
    { base: 97, count: 4 },// QF
    { base: 101, count: 2 },// SF
    { base: 104, count: 1 } // Final
  ];
  const r = ranges[roundIndex];
  if (!r) return seedR32Min + 100 + roundIndex * 10 + pairIndex;
  return r.base + pairIndex;
}

function getPickFor(bracket, matchNumber) {
  const entry = bracket?.picks?.[String(matchNumber)];
  if (!entry) return null;
  // Accept legacy string entries OR new {team, team_a, team_b} shape.
  if (typeof entry === 'string') return entry;
  return entry.team || null;
}

function setPickFor(bracket, matchNumber, team, pair) {
  bracket.picks = bracket.picks || {};
  if (!team) { delete bracket.picks[String(matchNumber)]; return; }
  bracket.picks[String(matchNumber)] = {
    team,
    team_a: pair?.team_a || null,
    team_b: pair?.team_b || null,
  };
}

function renderRound(round, bracket, draftKey, onChange, data, comp) {
  const section = document.createElement('section');
  section.className = 'bb-round';
  const filled = round.matches.filter((m) => m.pick).length;
  const pointsPerMatch = WEIGHTED_ROUND_POINTS[round.key] || 0;
  section.innerHTML = `
    <h3>${escapeHtml(round.key)} <span class="bb-round-meta muted">${filled}/${round.matches.length} picked · ${pointsPerMatch}pt each</span></h3>
  `;
  for (const m of round.matches) {
    const wrap = document.createElement('div');
    wrap.className = 'bb-pair';
    const aLocked = isSlotPlaceholder(m.team_a) || !m.team_a;
    const bLocked = isSlotPlaceholder(m.team_b) || !m.team_b;
    const aPicked = m.pick === m.team_a;
    const bPicked = m.pick === m.team_b;
    wrap.innerHTML = `
      <button type="button" class="bb-slot ${aPicked ? 'is-picked' : ''}" ${aLocked ? 'disabled' : ''} data-pick="a" data-match="${m.match_number}">
        <span class="bb-slot-flag">${aLocked ? '·' : flagFor(m.team_a)}</span>
        <span>${escapeHtml(m.team_a || 'Waiting…')}</span>
      </button>
      <div class="bb-pair-vs">vs</div>
      <button type="button" class="bb-slot ${bPicked ? 'is-picked' : ''}" ${bLocked ? 'disabled' : ''} data-pick="b" data-match="${m.match_number}">
        <span class="bb-slot-flag">${bLocked ? '·' : flagFor(m.team_b)}</span>
        <span>${escapeHtml(m.team_b || 'Waiting…')}</span>
      </button>
    `;
    wrap.addEventListener('click', (e) => {
      if (comp.lockState?.bracketLocked) return;
      const btn = e.target.closest('.bb-slot[data-pick]');
      if (!btn || btn.disabled) return;
      const choice = btn.dataset.pick === 'a' ? m.team_a : m.team_b;
      const pair = { team_a: m.team_a, team_b: m.team_b };
      const currentPick = getPickFor(bracket, m.match_number);
      if (currentPick === choice) {
        setPickFor(bracket, m.match_number, null);
      } else {
        setPickFor(bracket, m.match_number, choice, pair);
      }
      // Clearing downstream is correct whenever a pick changes — the next round's
      // feeder team likely shifted, so any prior derived pick is invalid.
      clearDownstream(bracket, m.match_number);
      persistBracket(draftKey, bracket);
      onChange();
    });
    section.appendChild(wrap);
  }
  return section;
}

function clearDownstream(bracket, fromMatchNumber) {
  // Determine which round this match is in and clear all later-round picks.
  // We don't track derived match numbers precisely so this clears all picks
  // for any match in a later round whose two feeders include this one.
  const stage = stageOfMatchNumber(fromMatchNumber);
  const order = ['R32', 'R16', 'QF', 'SF', 'Final'];
  const startIdx = order.indexOf(stage);
  if (startIdx < 0) return;
  for (let i = startIdx + 1; i < order.length; i++) {
    const range = matchRangeFor(order[i]);
    for (let mn = range.min; mn <= range.max; mn++) {
      if (bracket.picks?.[String(mn)]) delete bracket.picks[String(mn)];
    }
  }
}

function stageOfMatchNumber(num) {
  if (num <= 88) return 'R32';
  if (num <= 96) return 'R16';
  if (num <= 100) return 'QF';
  if (num <= 102) return 'SF';
  return 'Final';
}

function matchRangeFor(stage) {
  return {
    R32: { min: 73, max: 88 },
    R16: { min: 89, max: 96 },
    QF: { min: 97, max: 100 },
    SF: { min: 101, max: 102 },
    Final: { min: 104, max: 104 },
  }[stage];
}

function renderProjection(rounds, data) {
  const wrap = document.createElement('section');
  wrap.className = 'home-section';
  let max = 0;
  for (const r of rounds) {
    const pts = (WEIGHTED_ROUND_POINTS[r.key] || 0) * r.matches.length;
    max += pts;
  }
  // Add Champion bonus
  max += 16;
  // Naive current score: assume perfect on filled brackets (since no actuals yet)
  // We instead show "max possible if all of your picks come true"
  const projectedPerfect = MAX_WEIGHTED_SCORE;
  wrap.innerHTML = `
    <div class="home-card">
      <h2 class="home-card-title">Scoring</h2>
      <p class="muted" style="margin:0 0 6px;">Weighted by round: R32=1, R16=2, QF=4, SF=8, Final=16, Champion bonus=+16. Max possible: <strong>${projectedPerfect}</strong> pts.</p>
      <p class="muted" style="margin:0;">Tie-breakers: latest round correct → Champion correct → earliest submit → username.</p>
    </div>
  `;
  return wrap;
}

function renderSubmitBar(comp, done, total, onSubmit) {
  const bar = document.createElement('div');
  bar.className = 'bb-submit-bar';
  const hasGroup = !!comp.activeGroup;
  const complete = done === total;
  const locked = comp.lockState?.bracketLocked;
  const reason = !hasGroup ? 'Select a group above to submit.'
    : !complete ? `Pick all ${total} matchups to submit.`
    : locked ? `Bracket locked (${comp.lockState.phase}).`
    : 'Ready to submit.';
  bar.innerHTML = `
    <div>
      <div style="font-weight:700;">${escapeHtml(complete ? 'Bracket complete' : 'In progress')}</div>
      <div class="muted" style="font-size:12px;">${escapeHtml(reason)}</div>
    </div>
    <button class="pick-btn" id="mb-submit" ${(!hasGroup || !complete || locked) ? 'disabled' : ''}>Submit to group</button>
  `;
  const status = document.createElement('p');
  status.id = 'mb-submit-status';
  status.className = 'muted';
  status.style.cssText = 'margin:8px 0 0; font-size:12px;';
  bar.appendChild(status);
  const btn = bar.querySelector('#mb-submit');
  btn.addEventListener('click', () => onSubmit(status, btn));
  return bar;
}

function currentDraftKey(comp) {
  return comp.activeGroup?.id ? `${LS_KEY_PREFIX}${comp.activeGroup.id}` : `${LS_KEY_PREFIX}local`;
}

function loadBracket(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : { picks: {} };
    if (!parsed || typeof parsed !== 'object') return { picks: {} };
    if (!parsed.picks || typeof parsed.picks !== 'object') parsed.picks = {};
    return parsed;
  } catch { return { picks: {} }; }
}

function persistBracket(key, bracket) {
  try { localStorage.setItem(key, JSON.stringify(bracket)); } catch {}
  // Also persist as a "knockout picks" list in the format competition-scoring expects
  try {
    const picks = bracketToPickArray(bracket);
    localStorage.setItem(key + '.list', JSON.stringify(picks));
    // For local draft, also push to state picks so existing submit flow can use it
    if (key.endsWith('.local')) {
      // No-op — saveBracketForActiveGroup uses normalizeKnockoutPicks(allPicks())
      // which reads from app/state.js. We update that too:
      pushPicksToLocalState(picks);
    }
  } catch {}
}

function pushPicksToLocalState(picks) {
  try {
    const LS_PICKS = 'wc26.picks';
    const raw = localStorage.getItem(LS_PICKS);
    const existing = raw ? JSON.parse(raw) : {};
    const now = new Date().toISOString();
    for (const p of picks) {
      const k = `${p.team_a}__vs__${p.team_b}`;
      const prior = existing[k];
      // Only stamp a new picked_at if the choice changed (or didn't exist).
      // Preserve the original timestamp so leaderboard tie-breakers based on
      // earliest submit stay accurate.
      const choiceChanged = !prior || prior.choice !== p.choice;
      existing[k] = {
        team_a: p.team_a, team_b: p.team_b, choice: p.choice,
        picked_at: choiceChanged ? now : (prior?.picked_at || now),
      };
    }
    localStorage.setItem(LS_PICKS, JSON.stringify(existing));
  } catch {}
}

function bracketToPickArray(bracket) {
  // Convert {picks: {matchNumber: {team, team_a, team_b}}} -> [{team_a, team_b, choice}, ...]
  // Legacy: some saved entries were stored as plain strings (just the picked
  // team name). Those can't be submitted since we don't know the matchup; skip.
  const out = [];
  if (!bracket.picks) return out;
  for (const entry of Object.values(bracket.picks)) {
    if (!entry) continue;
    if (typeof entry === 'string') continue; // legacy shape — wait for re-pick
    if (typeof entry !== 'object') continue;
    const { team, team_a, team_b } = entry;
    if (!team || !team_a || !team_b) continue;
    const choice = team === team_a ? 'team_a' : team === team_b ? 'team_b' : null;
    if (!choice) continue;
    out.push({ team_a, team_b, choice });
  }
  return out;
}

function isSlotPlaceholder(s) {
  if (typeof s !== 'string') return true;
  return /^\d[A-L]$/.test(s) || /^3 [A-L]+$/.test(s) || /^W\d+$/.test(s) || /^L\d+$/.test(s);
}

function emptyCard(text) {
  const div = document.createElement('div');
  div.className = 'bb-empty home-card';
  div.textContent = text;
  return div;
}

function notice(text) {
  const div = document.createElement('div');
  div.className = 'bb-locked-banner';
  div.textContent = text;
  return div;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
