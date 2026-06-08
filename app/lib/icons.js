/* icons.js — one cohesive line-icon set (24×24, 2px stroke, currentColor) so the
 * app's navigation tiles theme with var(--accent) and stay consistent. Replaces
 * the emoji glyphs. The 'ball' glyph echoes the header Trionda ball. */
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  // Play = the prediction game (a pitch)
  play: '<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="12" y1="5" x2="12" y2="19"/><circle cx="12" cy="12" r="2.6"/>',
  // Matches = soccer ball (echoes the header ball)
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.6l3.2 2.3-1.2 3.8h-4l-1.2-3.8z"/><path d="M12 7.6V3.4"/><path d="M15.2 9.9l3.5-1.3"/><path d="M14 13.7l2.5 3.1"/><path d="M10 13.7l-2.5 3.1"/><path d="M8.8 9.9L5.3 8.6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="6.5"/><line x1="16" y1="3" x2="16" y2="6.5"/>',
  pin: '<path d="M12 21s6.5-6 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15 12 21 12 21z"/><circle cx="12" cy="10.3" r="2.4"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  bracket: '<path d="M5 4v16"/><path d="M5 8h5v8H5"/><path d="M10 12h4"/><path d="M14 7v10"/><path d="M14 12h5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 3.5h6v2.5H9z"/><path d="M8.5 13l2.2 2.2L16 10"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3"/><path d="M17 6h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4"/><path d="M8.5 20h7"/><path d="M10 17h4v3h-4z"/>',
  chart: '<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3.2" height="9" rx="0.6"/><rect x="10.4" y="7" width="3.2" height="13" rx="0.6"/><rect x="14.8" y="14" width="3.2" height="6" rx="0.6"/>',
  medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.6 10.6 6 3.5"/><path d="m15.4 10.6 2.6-7.1"/><path d="M9 3.5h6"/><path d="M12 13.3l.8 1.6 1.8.3-1.3 1.3.3 1.8-1.6-.85-1.6.85.3-1.8-1.3-1.3 1.8-.3z"/>',
  cross: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 8.3v7.4"/><path d="M8.3 12h7.4"/>',
};

export function icon(name, sw = 2) {
  return `<svg viewBox="0 0 24 24" xmlns="${NS}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

/* Per-category hue for the home Jump-to tiles — each tile gets its own vibrant
 * color (Apple-style), rendered as a frosted duotone chip (light hue-tint +
 * saturated glyph) by .home-link-icon. The chip styling derives both the tint
 * and the glyph color from this single --c, and adapts to light/dark surface. */
const TINTS = {
  play: '#34C759', ball: '#0A84FF', calendar: '#FF453A', pin: '#FF9F0A',
  grid: '#5E5CE6', bracket: '#32ADE6', clipboard: '#BF5AF2', flame: '#FF6B22',
  trophy: '#FFB300', chart: '#14B8A6', medal: '#FF2D55', cross: '#5AC8FA',
};

/* A colored home-link chip: the line glyph in its category hue on a soft tint. */
export function chip(name, sw = 2) {
  const c = TINTS[name] || 'var(--accent)';
  return `<span class="home-link-icon" style="--c:${c}" aria-hidden="true">${icon(name, sw)}</span>`;
}
