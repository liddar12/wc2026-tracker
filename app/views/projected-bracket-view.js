/* projected-bracket-view.js — COMPATIBILITY SHIM.
 *
 * The Projected tab now reuses bracket-view-r6's projected mode (see main.js
 * renderProjectedShim). This module is kept ONLY so any still-cached older
 * main.js that statically imports renderProjectedBracketView doesn't 404 and
 * fail to boot during deploy/CDN propagation. It delegates to the real
 * renderer, so even the old code path shows the correct projected bracket.
 * Safe to remove once no cached build references it (a later cleanup).
 */
import { renderBracketView } from './bracket-view-r6.js';

export function renderProjectedBracketView(root, data, params = {}) {
  return renderBracketView(root, data, { ...params, mode: params.mode || 'projected', routeName: 'projected' });
}
