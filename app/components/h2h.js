import { escapeHtml } from '../lib/escape.js';
import { emptyState } from '../lib/empty-state.js';
/* h2h.js — head-to-head: pill strip + summary tally + meetings table + biggest win.
 *
 * RJ30.1 Item 2. The stored rows are oriented to the stored key order. When the
 * pairing is stored reversed (altKey hit), scores must be swapped and the winner
 * re-derived relative to the LIVE match.team_a — this re-orientation is the top
 * correctness risk and is locked by a reversed-orientation unit test. */

/**
 * Re-orient one stored row to the live match.team_a perspective.
 * @param {object} rec stored row {date,comp,score_a,score_b,winner}
 * @param {boolean} swapped true when the altKey (team_b__vs__team_a) matched
 * @param {object} match {team_a, team_b}
 * @returns {{date,comp,score_a,score_b,winnerSide:'a'|'b'|'draw'|'?'}}
 */
function orientRow(rec, swapped, match) {
  const score_a = swapped ? rec.score_b : rec.score_a;
  const score_b = swapped ? rec.score_a : rec.score_b;
  let winnerSide = '?';
  if (rec.winner === 'draw') winnerSide = 'draw';
  else if (rec.winner === match.team_a) winnerSide = 'a';
  else if (rec.winner === match.team_b) winnerSide = 'b';
  return { date: rec.date, comp: rec.comp, score_a, score_b, winnerSide };
}

/**
 * Tally W/D/L and goals from the team_a perspective over oriented rows.
 * @param {Array<{score_a:number,score_b:number,winnerSide:string}>} oriented
 * @returns {{played:number,w:number,d:number,l:number,gf:number,ga:number}}
 */
export function summarize(oriented) {
  const out = { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  for (const r of oriented) {
    out.played += 1;
    out.gf += Number(r.score_a) || 0;
    out.ga += Number(r.score_b) || 0;
    if (r.winnerSide === 'a') out.w += 1;
    else if (r.winnerSide === 'b') out.l += 1;
    else out.d += 1; // draw or unknown → neutral
  }
  return out;
}

/**
 * The biggest decisive win across oriented rows (either team).
 * Margin ties resolve to the most recent (rows are date-desc → first wins).
 * @param {Array} oriented
 * @param {object} match {team_a, team_b}
 * @returns {{teamName,score_a,score_b,comp}|null} null when no decisive meeting.
 */
export function biggestWin(oriented, match) {
  let best = null;
  let bestMargin = -1;
  for (const r of oriented) {
    if (r.winnerSide !== 'a' && r.winnerSide !== 'b') continue;
    const margin = Math.abs((Number(r.score_a) || 0) - (Number(r.score_b) || 0));
    if (margin > bestMargin) {
      bestMargin = margin;
      best = {
        teamName: r.winnerSide === 'a' ? match.team_a : match.team_b,
        score_a: Number(r.score_a) || 0,
        score_b: Number(r.score_b) || 0,
        comp: r.comp ?? null,
      };
    }
  }
  return best;
}

export function h2hSection(match, h2h) {
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = '<h2>Head-to-head</h2>';

  const key1 = `${match.team_a}__vs__${match.team_b}`;
  const key2 = `${match.team_b}__vs__${match.team_a}`;
  const primary = (h2h || {})[key1];
  const swapped = !primary && !!(h2h || {})[key2];
  const raw = (primary || (h2h || {})[key2] || []).slice(0, 5);

  if (!raw.length) {
    sec.appendChild(
      emptyState('No prior meetings on record', {
        detail: 'These teams have no scraped head-to-head history yet.',
        icon: '🤝',
        testid: 'h2h-empty',
      })
    );
    return sec;
  }

  const oriented = raw.map((rec) => orientRow(rec, swapped, match));

  // Pill strip (preserved): one W/D/L pill per meeting, team_a perspective.
  const strip = document.createElement('div');
  strip.className = 'h2h-strip';
  for (const r of oriented) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    if (r.winnerSide === 'a') { pill.classList.add('pill-w'); pill.textContent = 'W'; }
    else if (r.winnerSide === 'b') { pill.classList.add('pill-l'); pill.textContent = 'L'; }
    else if (r.winnerSide === 'draw') { pill.classList.add('pill-d'); pill.textContent = 'D'; }
    else { pill.classList.add('pill-d'); pill.textContent = '?'; }
    pill.title = `${r.date || '?'} · ${match.team_a} ${r.score_a}-${r.score_b} ${match.team_b}`;
    strip.appendChild(pill);
  }
  sec.appendChild(strip);

  // Summary tally.
  const s = summarize(oriented);
  const summary = document.createElement('p');
  summary.className = 'h2h-summary';
  summary.setAttribute('data-testid', 'h2h-summary');
  summary.setAttribute(
    'aria-label',
    `${match.team_a} record vs ${match.team_b}: played ${s.played}, won ${s.w}, drawn ${s.d}, lost ${s.l}, goals ${s.gf} to ${s.ga}`
  );
  summary.innerHTML =
    `<span class="h2h-played">Played ${s.played}</span>` +
    `<span class="h2h-wdl"><strong class="h2h-w">W${s.w}</strong> <strong class="h2h-d">D${s.d}</strong> <strong class="h2h-l">L${s.l}</strong></span>` +
    `<span class="h2h-goals">${s.gf}–${s.ga}</span>`;
  sec.appendChild(summary);

  // Meetings table.
  const table = document.createElement('div');
  table.className = 'h2h-table';
  table.setAttribute('data-testid', 'h2h-table');
  for (const r of oriented) {
    const row = document.createElement('div');
    row.className = 'h2h-row';
    if (r.winnerSide === 'a') row.classList.add('is-winner-a');
    else if (r.winnerSide === 'b') row.classList.add('is-winner-b');
    else row.classList.add('is-draw');
    const compHtml = r.comp ? `<span class="h2h-comp">${escapeHtml(r.comp)}</span>` : '';
    row.innerHTML =
      `<span class="h2h-date">${escapeHtml(r.date || '')}</span>` +
      compHtml +
      `<span class="h2h-score">${escapeHtml(String(r.score_a))}–${escapeHtml(String(r.score_b))}</span>`;
    table.appendChild(row);
  }
  sec.appendChild(table);

  // Biggest win highlight (omitted when all draws / no decisive meeting).
  const bw = biggestWin(oriented, match);
  if (bw) {
    const line = document.createElement('p');
    line.className = 'h2h-biggest';
    line.setAttribute('data-testid', 'h2h-biggest');
    const compTxt = bw.comp ? `, ${escapeHtml(bw.comp)}` : '';
    line.innerHTML = `${escapeHtml(bw.teamName)}'s biggest win: ${escapeHtml(String(bw.score_a))}–${escapeHtml(String(bw.score_b))}${compTxt}`;
    sec.appendChild(line);
  }

  return sec;
}
