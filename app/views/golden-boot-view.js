/* golden-boot-view.js — R19: the Golden Boot tracker.
 *   - Live top-scorer leaderboard (goals) during the tournament.
 *   - Golden Boot odds (chance %) from the model, with the factor breakdown.
 *   - Live updates: main.js already re-renders the active view on
 *     data:live-refresh, so fresh goals/odds flow through automatically — no
 *     view-local listener needed.
 * Reached from Home → "Jump to" → #/golden-boot. */
import { setRoute } from '../state.js';
import { escapeHtml } from '../lib/escape.js';
import { flagFor } from '../components/team-flag.js';
import { goldenBootProjections } from '../lib/golden-boot.js';

export function renderGoldenBootView(root, data, params = {}) {
  if (!data) { root.innerHTML = '<p class="loading">Loading…</p>'; return; }
  root.innerHTML = '';
  root.appendChild(header());

  const contenders = goldenBootProjections(data, { sims: 8000 });
  const live = contenders.filter((c) => c.currentGoals > 0).sort((a, b) => b.currentGoals - a.currentGoals);

  if (live.length) root.appendChild(liveCard(live));
  root.appendChild(oddsCard(contenders));
  root.appendChild(howCard());
}

function header() {
  const s = document.createElement('section');
  s.className = 'home-card';
  s.style.marginBottom = '12px';
  s.innerHTML = `
    <button class="link-btn" id="gb-back" style="background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font-size:13px;">← Home</button>
    <h1 class="home-card-title" style="margin:4px 0 2px;">🥇 Golden Boot</h1>
    <p class="muted" style="margin:0; font-size:13px;">Who's most likely to finish the tournament's top scorer — live goals + a model projection.</p>`;
  s.querySelector('#gb-back')?.addEventListener('click', () => setRoute('home', {}));
  return s;
}

function liveCard(live) {
  const s = document.createElement('section');
  s.className = 'home-card';
  s.style.marginBottom = '12px';
  s.dataset.testid = 'gb-live';
  s.innerHTML = `
    <h2 class="home-card-title">Live top scorers</h2>
    <ol class="pw-standings">${live.slice(0, 12).map((c, i) => `
      <li class="pw-standings-row">
        <span class="pw-standings-place">${i + 1}</span>
        <span class="pw-standings-name">${flagFor(c.team)} ${escapeHtml(c.player)} <span class="muted">${escapeHtml(c.team)}</span></span>
        <span class="pw-standings-pts"><strong>${c.currentGoals}</strong> ${c.currentGoals === 1 ? 'goal' : 'goals'}</span>
      </li>`).join('')}</ol>`;
  return s;
}

function oddsCard(contenders) {
  const s = document.createElement('section');
  s.className = 'home-card';
  s.style.marginBottom = '12px';
  s.dataset.testid = 'gb-odds';
  const top = contenders.slice(0, 20);
  const blended = contenders.blendedWithMarket === true;
  s.innerHTML = `
    <h2 class="home-card-title">Golden Boot odds</h2>
    <p class="muted" style="margin:0 0 10px; font-size:12px;">Chance to finish top scorer — the model${blended ? ' blended 50/50 with the live Kalshi Golden Boot market' : ''}. Updates through the day.</p>
    <ol class="pw-standings" data-testid="gb-odds-list">${top.map((c) => `
      <li class="pw-standings-row">
        <span class="pw-standings-place">${c.rank}</span>
        <span class="pw-standings-name">
          ${flagFor(c.team)} ${escapeHtml(c.player)} <span class="muted">${escapeHtml(c.team)}</span>
          <span class="gb-factors muted">
            <span title="Expected matches (deep run)">🏟️ ${c.factors.deepRun}</span>
            <span title="Opponent defense factor (>1 = weak opponents)">🛡️ ${c.factors.oppDefense}</span>
            ${c.factors.setPiece ? '<span title="Likely penalty taker (heuristic)">⚽ PK</span>' : ''}
            ${c.marketPct ? `<span title="Kalshi Golden Boot market odds">📊 ${c.marketPct}%</span>` : ''}
          </span>
        </span>
        <span class="pw-standings-pts"><strong>${c.bootPct}%</strong><span class="pw-standings-split">~${c.projGoals} goals</span></span>
      </li>`).join('')}</ol>`;
  return s;
}

function howCard() {
  const s = document.createElement('section');
  s.className = 'home-card';
  s.innerHTML = `
    <h2 class="home-card-title">How the odds are built</h2>
    <ul class="muted" style="margin:0; padding-left:18px; font-size:13px; line-height:1.6;">
      <li><strong>Finishing</strong> — each player's scoring rating + position.</li>
      <li><strong>Deep run</strong> — stronger teams play more games (more chances to score).</li>
      <li><strong>Opponent defense</strong> — facing weaker defenses inflates goal output.</li>
      <li><strong>Scoring environment</strong> — expected goals (xG) of the team's matches.</li>
      <li><strong>Set pieces</strong> — penalty/free-kick takers pad totals (heuristic for now).</li>
      <li><strong>Deep run</strong> — expected games from the hybrid forecast (group + knockout path).</li>
      <li><strong>Market</strong> — blended 50/50 with the live Kalshi Golden Boot market (📊), an independent signal.</li>
      <li><strong>Live goals</strong> — actual goals scored, blended in during the tournament.</li>
    </ul>
    <p class="muted" style="margin:10px 0 0; font-size:11px;">A seeded Monte-Carlo simulates the rest of the tournament thousands of times to estimate each player's chance of finishing top scorer, then blends in the Kalshi market. Inputs (squads, xG, hybrid forecast, Kalshi market, live goals) refresh multiple times a day, so the odds move through the tournament.</p>`;
  return s;
}
