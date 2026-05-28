/* bracket-view.js — SVG bracket from R32 -> R16 -> QF -> SF -> Final.
 *
 * Sources for the seeded R32 column:
 *   1. If actualResults has a non-empty `qualified_for_r32` array, use that.
 *   2. Else, project: take projected top-2 from each group plus the 8 best 3rd-place
 *      teams by projected expected points.
 *
 * Downstream rounds are populated from actualResults where available, otherwise
 * show "TBD" and let the user tap a node to see the model's head-to-head call.
 */
import { setRoute, allPicks } from '../state.js';
import { flagFor } from '../components/team-flag.js';
import { modelChoice } from '../predictions.js';

export function renderBracketView(root, data) {
  const seeded = seedRound32(data);

  // Round structure: 32 -> 16 -> 8 -> 4 -> 2 -> 1.
  //
  // We try actual results first (from actualResults). When they're missing
  // (pre-tournament, or stage not yet played), we project the winner from
  // the composite gap so the bracket has real names all the way to the final
  // instead of collapsing to a single TBD column chain.
  const r32Pairs = pairUp(seeded);
  const rounds = [
    { name: 'R32', pairs: r32Pairs }
  ];

  rounds.push({ name: 'R16', pairs: pairUp(advanceOrProject(r32Pairs, data, 'round_of_32')) });
  rounds.push({ name: 'QF', pairs: pairUp(advanceOrProject(rounds[1].pairs, data, 'round_of_16')) });
  rounds.push({ name: 'SF', pairs: pairUp(advanceOrProject(rounds[2].pairs, data, 'quarterfinals')) });
  rounds.push({ name: 'Final', pairs: pairUp(advanceOrProject(rounds[3].pairs, data, 'semifinals')) });
  rounds.push({ name: 'Champion', pairs: [[advanceOrProjectOne(rounds[4].pairs[0], data, 'final'), null]] });

  // Build SVG
  const COL_W = 170;
  const NODE_H = 30;
  const NODE_GAP_BASE = 8;
  const totalCols = rounds.length;
  const maxNodes = r32Pairs.length * 2;
  const svgH = maxNodes * (NODE_H + NODE_GAP_BASE) + 20;
  const svgW = COL_W * totalCols;

  const wrap = document.createElement('div');
  wrap.className = 'bracket-wrap';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'bracket-svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  // Column header labels
  rounds.forEach((r, i) => {
    const text = svgEl('text', { x: i * COL_W + 10, y: 14, fill: 'currentColor', 'font-size': 12 });
    text.textContent = r.name;
    svg.appendChild(text);
  });

  // Render nodes per column
  const picks = allPicks();
  const pickMap = new Map();
  for (const p of picks) {
    pickMap.set(`${p.team_a}__${p.team_b}`, p);
    pickMap.set(`${p.team_b}__${p.team_a}`, p);
  }

  rounds.forEach((round, colIdx) => {
    const nodesThisCol = round.pairs.flat().filter(Boolean).length || round.pairs.length * 2;
    const slotsThisCol = Math.max(2, round.pairs.length * 2);
    const colHeight = svgH - 30;
    const slotH = colHeight / slotsThisCol;
    round.pairs.forEach((pair, pairIdx) => {
      const [a, b] = pair;
      const yA = 30 + (pairIdx * 2) * slotH;
      const yB = 30 + (pairIdx * 2 + 1) * slotH;
      drawTeamNode(svg, colIdx * COL_W + 6, yA, COL_W - 14, NODE_H, a, data, pickMap, round, pair);
      if (b !== null) drawTeamNode(svg, colIdx * COL_W + 6, yB, COL_W - 14, NODE_H, b, data, pickMap, round, pair);

      // Draw connector to next column
      if (colIdx < totalCols - 1) {
        const nextSlotH = colHeight / Math.max(2, rounds[colIdx + 1].pairs.length * 2);
        const nextY = 30 + Math.floor(pairIdx) * nextSlotH + NODE_H / 2;
        const x1 = (colIdx + 1) * COL_W - 8;
        const x2 = (colIdx + 1) * COL_W + 6;
        const midY = (yA + yB) / 2 + NODE_H / 2;
        const path = svgEl('path', {
          class: 'conn',
          d: `M ${x1} ${yA + NODE_H / 2} L ${x1 + 6} ${yA + NODE_H / 2} L ${x1 + 6} ${midY} L ${x1 + 6} ${yB + NODE_H / 2} L ${x1} ${yB + NODE_H / 2} M ${x1 + 6} ${midY} L ${x2} ${midY}`,
          stroke: 'currentColor',
          'stroke-opacity': '0.25',
          fill: 'none'
        });
        svg.appendChild(path);
      }
    });
  });

  wrap.appendChild(svg);
  root.appendChild(legend());
  root.appendChild(wrap);

  // Click handler: tap node -> show model prediction modal (simple inline div)
  svg.addEventListener('click', (e) => {
    const g = e.target.closest('g.bracket-node');
    if (!g) return;
    const aName = g.dataset.team;
    const oppName = g.dataset.opp;
    if (!aName || !oppName) return;
    showPredictionPopup(root, data, aName, oppName);
  });
}

function drawTeamNode(svg, x, y, w, h, team, data, pickMap, round, pair) {
  const g = svgEl('g', { class: 'bracket-node' });
  const oppName = pair?.find(t => t && t !== team);
  const teamName = team || 'TBD';
  if (team && oppName) {
    g.dataset.team = team;
    g.dataset.opp = oppName;
  }

  // Pick correctness coloring for completed matches (best-effort against any
  // tier of actualResults).
  let isActual = false;
  if (team && oppName) {
    const pick = pickMap.get(`${team}__${oppName}`);
    const actual = lookupActual(data, team, oppName);
    if (actual) isActual = true;
    if (pick && actual) {
      g.classList.add(pick.choice === actual ? 'correct' : 'wrong');
    } else if (pick) {
      g.dataset.pickPending = '1';
    }
  }
  // Mark projected (model-derived) names after R32 so the user can tell them
  // apart from real outcomes. R32 itself is the seeded bracket and is not
  // marked projected.
  if (team && !isActual && round?.name !== 'R32') {
    g.classList.add('projected');
  }

  const rect = svgEl('rect', { x, y, width: w, height: h, rx: 6, ry: 6 });
  g.appendChild(rect);

  const flag = svgEl('text', { x: x + 8, y: y + h / 2 + 5, 'font-size': 14 });
  flag.textContent = team ? flagFor(team) : '·';
  g.appendChild(flag);

  const name = svgEl('text', { x: x + 30, y: y + h / 2 + 4, 'font-size': 11 });
  name.textContent = teamName.length > 16 ? teamName.slice(0, 15) + '…' : teamName;
  g.appendChild(name);

  svg.appendChild(g);
}

function legend() {
  const div = document.createElement('div');
  div.className = 'section';
  div.innerHTML = `
    <h2>Bracket</h2>
    <p class="muted" style="font-size:12px;">
      Tap any node to see the model's head-to-head call. Future rounds show
      <em>projected</em> winners (dashed outline) derived from composite gap.
      Green outline = your pick was correct · red = wrong.
    </p>
  `;
  return div;
}

function seedRound32(data) {
  // From actualResults if available
  const qr = data.actualResults?.qualified_for_r32;
  if (Array.isArray(qr) && qr.length === 32) return qr;

  // Project from group_matchups + expected_points
  const groupStandings = [];
  for (const [g, info] of Object.entries(data.groupMatchups)) {
    const acc = Object.fromEntries(info.teams.map(t => [t, { team: t, xpts: 0, group: g }]));
    for (const m of info.matches) {
      acc[m.team_a].xpts += m.expected_points.team_a;
      acc[m.team_b].xpts += m.expected_points.team_b;
    }
    const sorted = Object.values(acc).sort((a, b) => b.xpts - a.xpts);
    groupStandings.push({ group: g, sorted });
  }

  const winners = groupStandings.map(s => s.sorted[0]);   // 12
  const runnersUp = groupStandings.map(s => s.sorted[1]); // 12
  const thirds = groupStandings.map(s => s.sorted[2]).sort((a, b) => b.xpts - a.xpts).slice(0, 8);

  // Standard WC R32 layout balances groups across the bracket. Without an official
  // template for 2026, we pair group winners against best 3rd-place / runner-ups in
  // a deterministic 1-vs-N split that produces a sensible bracket for visualization.
  const ordered = [];
  for (let i = 0; i < 12; i++) {
    ordered.push(winners[i].team);
    ordered.push(runnersUp[11 - i].team);
  }
  for (const t of thirds) ordered.push(t.team);
  return ordered.slice(0, 32);
}

function pairUp(list) {
  const pairs = [];
  for (let i = 0; i < list.length; i += 2) pairs.push([list[i] || null, list[i + 1] || null]);
  return pairs;
}

function advanceOrProject(pairs, data, stageKey) {
  return pairs.map(([a, b]) => {
    if (!a || !b) return a || b || null;
    const actual = lookupActualWinner(data, a, b, stageKey);
    if (actual) return actual;
    return projectWinner(data, a, b);
  });
}

function advanceOrProjectOne(pair, data, stageKey) {
  const [a, b] = pair;
  if (!a || !b) return a || b || null;
  const actual = lookupActualWinner(data, a, b, stageKey);
  if (actual) return actual;
  return projectWinner(data, a, b);
}

function projectWinner(data, a, b) {
  const ca = data.teams?.[a]?.composite;
  const cb = data.teams?.[b]?.composite;
  if (typeof ca !== 'number' || typeof cb !== 'number') return a; // arbitrary tie-breaker
  if (ca === cb) return a;
  return ca > cb ? a : b;
}

function lookupActual(data, a, b) {
  const stages = ['group_stage', 'round_of_32', 'round_of_16', 'quarterfinals', 'semifinals', 'third_place', 'final'];
  for (const s of stages) {
    const tier = data.actualResults?.[s];
    if (!tier) continue;
    const rec = tier[`${a}__vs__${b}`] || tier[`${b}__vs__${a}`];
    if (!rec) continue;
    const sa = rec.score_a ?? rec.team_a_score;
    const sb = rec.score_b ?? rec.team_b_score;
    if (typeof sa !== 'number' || typeof sb !== 'number') continue;
    const flipped = !!tier[`${b}__vs__${a}`];
    if (sa > sb) return flipped ? 'team_b' : 'team_a';
    if (sa < sb) return flipped ? 'team_a' : 'team_b';
    return 'draw';
  }
  return null;
}

function lookupActualWinner(data, a, b, stageKey) {
  const tier = data.actualResults?.[stageKey];
  if (!tier) return null;
  const rec = tier[`${a}__vs__${b}`] || tier[`${b}__vs__${a}`];
  if (!rec) return null;
  const winner = rec.winner;
  if (winner === a || winner === b) return winner;
  return null;
}

function showPredictionPopup(root, data, a, b) {
  // Remove existing popup
  root.querySelector('.bracket-popup')?.remove();
  const ta = data.teams[a];
  const tb = data.teams[b];
  if (!ta || !tb) return;
  // Simple inline win-probability via composite gap
  const ca = ta.composite, cb = tb.composite;
  const gap = ca - cb;
  const pA = winProbFromGap(gap);
  const pB = winProbFromGap(-gap);
  const div = document.createElement('div');
  div.className = 'section bracket-popup';
  div.style.cssText = 'border:1px solid var(--border); border-radius:12px; padding:12px; background: var(--surface); margin-top:12px;';
  div.innerHTML = `
    <h2 style="margin-top:0;">Model: ${escapeHtml(a)} vs ${escapeHtml(b)}</h2>
    <p class="muted" style="font-size:12px;">Composite ${ca?.toFixed(1)} vs ${cb?.toFixed(1)} → ${escapeHtml(a)} ~${(pA * 100).toFixed(0)}% · ${escapeHtml(b)} ~${(pB * 100).toFixed(0)}%</p>
    <button class="pick-btn" type="button" data-dismiss>Close</button>
  `;
  div.querySelector('[data-dismiss]').addEventListener('click', () => div.remove());
  root.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function winProbFromGap(gap) {
  // Logistic on composite gap; calibrated to roughly match group_matchups probabilities.
  return 1 / (1 + Math.exp(-gap / 4.5));
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
