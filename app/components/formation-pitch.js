import { escapeHtml } from '../lib/escape.js';
/* formation-pitch.js — RJ30.1 Item 1.
 *
 * Pure render module: given one side's { xi:[11], formation:"4-2-3-1" } it lays
 * the starting XI out on a vertical green pitch by formation (GK at the bottom,
 * attack toward the top). No network, no state import, no router — display only.
 *
 * Graceful degradation: when the formation can't be parsed (missing / non-numeric
 * / outfield digits don't sum to 10) or the XI isn't exactly 11, it falls back to
 * the existing numbered <ol class="xi-list"> so there's no information regression
 * and it never throws.
 */

/**
 * Parse a formation string ("4-2-3-1") into an array of outfield row sizes.
 * @param {string} formation
 * @returns {number[]|null} e.g. [4,2,3,1], or null when invalid.
 *   Invalid = missing / non "d-d…" / any non-positive-integer part /
 *   outfield digits don't sum to 10 (so GK + 10 outfield = 11) / more than 5 rows.
 */
export function parseFormation(formation) {
  if (typeof formation !== 'string') return null;
  const trimmed = formation.trim();
  if (!trimmed) return null;
  // strict: digits joined by single hyphens, e.g. "4-2-3-1"
  if (!/^\d+(-\d+)+$/.test(trimmed)) return null;
  const rows = trimmed.split('-').map((n) => Number(n));
  if (rows.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  if (rows.length > 5) return null; // GK + up to 5 outfield rows
  const sum = rows.reduce((a, b) => a + b, 0);
  if (sum !== 10) return null; // 10 outfield + 1 GK = 11
  return rows;
}

/**
 * Lay the XI out into rows: [[GK], ...outfield rows attack→…→def order as given].
 * The returned array is ordered defense-first (GK, then the formation rows in the
 * order the string lists them, i.e. defenders → … → strikers); the renderer draws
 * it bottom(GK)→top(attack).
 * @param {string[]} xi length-11 names, GK at index 0 (true across the dataset).
 * @param {number[]} rows from parseFormation.
 * @returns {Array<string[]>|null} null when xi isn't 11 or rows is null.
 */
export function assignRows(xi, rows) {
  if (!Array.isArray(xi) || xi.length !== 11) return null;
  if (!Array.isArray(rows)) return null;
  if (rows.reduce((a, b) => a + b, 0) !== 10) return null;
  const out = [[xi[0]]]; // GK
  let i = 1;
  for (const size of rows) {
    out.push(xi.slice(i, i + size));
    i += size;
  }
  return out;
}

/** surname = last whitespace-delimited token of the (already-trimmed) name. */
function surnameOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/);
  return parts[parts.length - 1] || String(name ?? '');
}

/**
 * One player token: numbered jersey circle + surname, full name in title/aria.
 * @param {string} name
 * @param {number} idx 0-based XI index (shirt-ish number = idx+1).
 */
function playerToken(name, idx) {
  const full = escapeHtml(name);
  const surname = escapeHtml(surnameOf(name));
  const el = document.createElement('div');
  el.className = 'fp-player';
  el.setAttribute('title', String(name ?? ''));
  el.setAttribute('aria-label', `${idx + 1}. ${String(name ?? '')}`);
  el.innerHTML = `<span class="fp-num" aria-hidden="true">${idx + 1}</span><span class="fp-name">${surname}</span>`;
  return el;
}

/** Build the existing numbered XI list (the graceful fallback). */
function xiListFallback(teamName, side) {
  const wrap = document.createElement('div');
  wrap.className = 'fp-wrap fp-fallback';
  wrap.setAttribute('data-testid', 'formation-pitch');
  wrap.innerHTML = `
    <ol class="xi-list">
      ${(side.xi || []).map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
    </ol>
  `;
  return wrap;
}

/**
 * Render one side's pitch (or a list fallback).
 * @param {string} teamName
 * @param {{xi:string[], formation:string}|null} side
 * @returns {HTMLElement} a <div class="fp-wrap" data-testid="formation-pitch">.
 */
export function formationPitch(teamName, side) {
  if (!side || !Array.isArray(side.xi)) {
    // Defensive: should be handled upstream (emptyState), but never throw.
    const wrap = document.createElement('div');
    wrap.className = 'fp-wrap fp-fallback';
    wrap.setAttribute('data-testid', 'formation-pitch');
    return wrap;
  }

  const parsed = parseFormation(side.formation);
  const rows = assignRows(side.xi, parsed);
  if (!rows) return xiListFallback(teamName, side);

  const wrap = document.createElement('div');
  wrap.className = 'fp-wrap';
  wrap.setAttribute('data-testid', 'formation-pitch');

  const pitch = document.createElement('div');
  pitch.className = 'fp-pitch';
  pitch.setAttribute('role', 'img');
  pitch.setAttribute('aria-label', `${String(teamName ?? '')} lineup, formation ${escapeHtml(side.formation)}`);

  // Draw attack at the top, GK at the bottom: rows[] is GK-first, so reverse.
  // Track the running XI index so token numbers match the XI order.
  const indexed = [];
  let idx = 0;
  for (const row of rows) {
    indexed.push(row.map((n) => ({ name: n, idx: idx++ })));
  }
  for (const row of indexed.slice().reverse()) {
    const rowEl = document.createElement('div');
    rowEl.className = 'fp-row';
    for (const p of row) rowEl.appendChild(playerToken(p.name, p.idx));
    pitch.appendChild(rowEl);
  }

  wrap.appendChild(pitch);
  return wrap;
}
