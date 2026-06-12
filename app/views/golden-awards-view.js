/* golden-awards-view.js — the Golden Awards section: Boot · Ball · Glove · Young
 * Player, each a transparent model blended with its live Kalshi market. Tabs via
 * ?award=. Reached from Home → "Jump to" → #/golden-awards (#/golden-boot aliases
 * to the Boot tab). Live updates flow via main.js's data:live-refresh re-render. */
import { setRoute } from '../state.js';
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from '../components/team-flag.js';
import { goldenBootProjections } from '../lib/golden-boot.js';
import { goldenBall, goldenGlove, youngPlayer } from '../lib/golden-awards.js';

const TABS = [
  { id: 'boot', label: 'Boot', emoji: '🥇' },
  { id: 'ball', label: 'Ball', emoji: '🏆' },
  { id: 'glove', label: 'Glove', emoji: '🧤' },
  { id: 'young', label: 'Young', emoji: '🌟' },
];

export function renderGoldenAwardsView(root, data, params = {}) {
  if (!data) { root.innerHTML = '<p class="loading">Loading…</p>'; return; }
  const award = TABS.some((t) => t.id === params.award) ? params.award : 'boot';
  root.innerHTML = '';
  root.appendChild(header(award));

  if (award === 'boot') {
    const c = goldenBootProjections(data, { sims: 8000 });
    // Columned list (owner spec, June 11): odds prediction alongside ACTUAL
    // goals scored and the model's projected final total — replaces the
    // separate "Live top scorers" card.
    root.appendChild(bootTable(c));
    root.appendChild(howCard('boot'));
    return;
  }

  const fn = award === 'ball' ? goldenBall : award === 'glove' ? goldenGlove : youngPlayer;
  const c = fn(data, {});
  const meta = {
    ball: { title: 'Golden Ball odds', note: 'Best player of the tournament — model (talent + attack + deep run) blended 65% with the market.' },
    glove: { title: 'Golden Glove odds', note: 'Best goalkeeper — model (GK rating + team defense + deep run) blended 50/50 with the market.' },
    young: { title: 'Young Player odds', note: 'Best player aged 21 or under — model blended 65% with the market.' },
  }[award];
  root.appendChild(oddsCard(c, {
    title: meta.title, pct: 'awardPct',
    factors: award === 'glove' ? gloveFactors : ballFactors,
    suffix: (x) => `model ${x.modelPct}%`, note: meta.note + ' Updates through the day.',
  }));
  root.appendChild(howCard(award));
}

function header(award) {
  const s = document.createElement('section');
  s.className = 'home-card';
  s.style.marginBottom = '12px';
  const tabs = TABS.map((t) => `
    <button class="pw-model-chip ${t.id === award ? 'is-active' : ''}" data-award="${t.id}"
      style="cursor:pointer;">${t.emoji} ${t.label}</button>`).join('');
  s.innerHTML = `
    <button class="link-btn" id="gb-back" style="background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font-size:13px;">← Home</button>
    <h1 class="home-card-title" style="margin:4px 0 6px;">🏆 Golden Awards</h1>
    <div class="pw-model-picker-chips" style="display:flex;gap:6px;flex-wrap:wrap;">${tabs}</div>`;
  s.querySelector('#gb-back')?.addEventListener('click', () => setRoute('home', {}));
  s.querySelectorAll('[data-award]').forEach((b) => b.addEventListener('click',
    () => setRoute('golden-awards', { award: b.dataset.award })));
  return s;
}

function bootTable(contenders) {
  // Golden Boot columned list: Odds (model+market prediction) · Goals (actual,
  // live scorers feed) · Proj (projected FINAL total = actual + modeled
  // remaining). Sorted by odds; players already on goals float naturally as
  // their odds/projections rise with each goal (refreshed by the cron).
  const s = document.createElement('section');
  s.className = 'home-card'; s.style.marginBottom = '12px'; s.dataset.testid = 'gb-odds';
  // Top 20 by odds PLUS every player who has actually scored (owner spec:
  // all scorers must be on the list with their odds, even outside the top 20).
  const top20 = contenders.slice(0, 20);
  const shown = new Set(top20.map((c) => c.player));
  const extraScorers = contenders
    .filter((c) => c.currentGoals > 0 && !shown.has(c.player))
    .sort((a, b) => b.currentGoals - a.currentGoals || (b.bootPct || 0) - (a.bootPct || 0));
  const top = top20.concat(extraScorers);
  s.innerHTML = `
    <h2 class="home-card-title">Golden Boot odds</h2>
    <p class="muted" style="margin:0 0 10px; font-size:12px;">Prediction vs reality — win odds, goals scored so far, and the model's projected final total. Updates through the day.</p>
    <div class="gb-table-head muted" aria-hidden="true"><span></span><span>Player</span><span>Odds</span><span>Goals</span><span>Proj</span></div>
    <ol class="gb-table" data-testid="gb-odds-list">${top.map((c) => `
      <li class="gb-table-row">
        <span class="gb-rank">${c.rank}</span>
        <span class="gb-player">
          ${flagFor(c.team)} ${escapeHtml(c.player)} <span class="muted">${escapeHtml(c.team)}</span>
          <span class="gb-factors muted">${bootFactors(c)}</span>
        </span>
        <span class="gb-odds"><strong>${c.bootPct}%</strong></span>
        <span class="gb-goals" title="Goals scored so far">${c.currentGoals}</span>
        <span class="gb-proj muted" title="Projected final total">~${c.projGoals}</span>
      </li>`).join('')}</ol>`;
  return s;
}

const mktChip = (c) => (c.marketPct ? `<span title="market odds">📊 ${c.marketPct}%</span>` : '');
function bootFactors(c) {
  return `<span title="Expected matches (deep run)">🏟️ ${c.factors.deepRun}</span>
    <span title="Opponent defense factor">🛡️ ${c.factors.oppDefense}</span>
    ${c.factors.setPiece ? '<span title="Likely penalty taker (heuristic)">⚽ PK</span>' : ''}${mktChip(c)}`;
}
function ballFactors(c) {
  return `<span title="Player overall rating">💪 ${c.factors.talent}</span>
    <span title="Deep-run odds (final + champion)">🏟️ ${c.factors.deepRun}%</span>
    ${c.age != null ? `<span title="Age">🎂 ${c.age}</span>` : ''}${mktChip(c)}`;
}
function gloveFactors(c) {
  return `<span title="GK overall rating">🧤 ${c.factors.gkRating}</span>
    <span title="Team defensive strength">🛡️ ${c.factors.teamDef}</span>
    <span title="Deep-run odds (SF + final + champion)">🏟️ ${c.factors.deepRun}%</span>${mktChip(c)}`;
}

function oddsCard(contenders, opts) {
  const s = document.createElement('section');
  s.className = 'home-card'; s.style.marginBottom = '12px'; s.dataset.testid = 'gb-odds';
  const top = contenders.slice(0, 20);
  s.innerHTML = `
    <h2 class="home-card-title">${escapeHtml(opts.title)}</h2>
    <p class="muted" style="margin:0 0 10px; font-size:12px;">${escapeHtml(opts.note)}</p>
    <ol class="pw-standings" data-testid="gb-odds-list">${top.map((c) => `
      <li class="pw-standings-row">
        <span class="pw-standings-place">${c.rank}</span>
        <span class="pw-standings-name">
          ${flagFor(c.team)} ${escapeHtml(c.player)} <span class="muted">${escapeHtml(c.team)}</span>
          <span class="gb-factors muted">${opts.factors(c)}</span>
        </span>
        <span class="pw-standings-pts"><strong>${c[opts.pct]}%</strong><span class="pw-standings-split">${escapeHtml(opts.suffix(c))}</span></span>
      </li>`).join('')}</ol>`;
  return s;
}

function howCard(award) {
  const bullets = {
    boot: ['<strong>Finishing</strong> — scoring rating + position.', '<strong>Deep run</strong> — expected games (hybrid forecast).', '<strong>Opponent defense</strong> + <strong>xG environment</strong>.', '<strong>Market</strong> — blended 50/50 with the Golden Boot market (📊).'],
    ball: ['<strong>Talent</strong> — player overall rating.', '<strong>Attack</strong> — offensive output (goals + creativity).', '<strong>Deep run</strong> — finalist/champion odds (the Ball favours deep teams).', '<strong>Market</strong> — blended 65% with the Golden Ball market (📊).'],
    glove: ['<strong>GK rating</strong> — keeper overall.', '<strong>Team defense</strong> — clean-sheet potential.', '<strong>Deep run</strong> — more games + visibility (SF/final/champion).', '<strong>Market</strong> — blended 50/50 with the Golden Glove market (📊).'],
    young: ['<strong>Eligibility</strong> — players aged 21 or under.', '<strong>Talent + attack + deep run</strong> — same as the Golden Ball model.', '<strong>Market</strong> — blended 65% with the Best Young Player market (📊).'],
  }[award];
  const s = document.createElement('section');
  s.className = 'home-card';
  s.innerHTML = `
    <h2 class="home-card-title">How the odds are built</h2>
    <ul class="muted" style="margin:0; padding-left:18px; font-size:13px; line-height:1.6;">
      ${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
    <p class="muted" style="margin:10px 0 0; font-size:11px;">Inputs (squads, ratings, hybrid forecast, the award's market, live goals) refresh multiple times a day, so the odds move through the tournament.</p>`;
  return s;
}
