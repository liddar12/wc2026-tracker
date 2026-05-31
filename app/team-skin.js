/* team-skin.js — apply the favorite team's brand color as --skin-accent.
   Per Q18: ACCENT STROKES ONLY — does not recolor the entire chrome. The
   v2 token layer reads var(--skin-accent, default-coral) on:
     - active tab pill
     - primary CTA background
     - favorite-team card border
     - large-match-card banner gradient
*/

import { getFavoriteTeam } from './favorites.js';

let cachedColors = null;

async function loadColors() {
  if (cachedColors) return cachedColors;
  try {
    const res = await fetch('data/team_colors.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('fetch failed');
    cachedColors = await res.json();
  } catch {
    cachedColors = {};
  }
  return cachedColors;
}

// Pick an accent color that's visually distinct on the app's surface
// background. Avoids pure white / near-white (which would render invisible
// on light surfaces) by falling back to the team's secondary or tertiary.
function pickAccent(entry) {
  if (!entry) return null;
  const candidates = [entry.primary, entry.secondary, entry.tertiary].filter(Boolean);
  for (const hex of candidates) {
    if (!hex) continue;
    if (looksTooBright(hex)) continue; // skip whites
    if (looksTooDark(hex)) continue;   // skip blacks
    return hex;
  }
  return candidates[0] || null;
}

function looksTooBright(hex) {
  const { r, g, b } = parseHex(hex);
  // sRGB luminance approximation
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return y > 0.85;
}
function looksTooDark(hex) {
  const { r, g, b } = parseHex(hex);
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return y < 0.07;
}
function parseHex(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export async function applyTeamSkin() {
  const team = getFavoriteTeam();
  const root = document.documentElement;
  if (!team) {
    root.style.removeProperty('--skin-accent');
    root.removeAttribute('data-team-skin');
    return null;
  }
  const colors = await loadColors();
  const entry = colors[team];
  const accent = pickAccent(entry);
  if (!accent) {
    root.style.removeProperty('--skin-accent');
    root.removeAttribute('data-team-skin');
    return null;
  }
  root.style.setProperty('--skin-accent', accent);
  root.setAttribute('data-team-skin', team);
  return accent;
}

export function initTeamSkin() {
  // Apply at load + on every favorite change.
  applyTeamSkin();
  window.addEventListener('favorite:change', () => applyTeamSkin());
}

// Re-export so other modules can read the color directly (e.g. for the
// stadium banner gradient on match detail).
export async function getTeamAccent(teamName) {
  if (!teamName) return null;
  const colors = await loadColors();
  return pickAccent(colors[teamName]);
}
export async function getTeamColors(teamName) {
  if (!teamName) return null;
  const colors = await loadColors();
  return colors[teamName] || null;
}
