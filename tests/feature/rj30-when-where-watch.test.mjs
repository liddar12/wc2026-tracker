/* rj30-when-where-watch.test.mjs — RCA (a): the When/Where/Watch panel looked up
   the schedule row by a team-pair match_id, which every KNOCKOUT row misses
   (knockout rows are keyed by SLOT ids like "M080__1L__vs__3_EHIJK" but still
   carry team_a/team_b). The fixed lookup matches by TEAM NAME in both
   orientations, so a knockout fixture resolves its kickoff + venue + watch panel.

   DOM-free via a minimal self-contained shim (no jsdom), installed before the
   component import so its module-eval sees `document`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM shim ------------------------------------------------------
class El {
  constructor(tag) { this.tagName = tag; this.className = ''; this.childNodes = []; this._html = ''; }
  appendChild(c) { this.childNodes.push(c); return c; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  get outerHTML() {
    const kids = this.childNodes.map((c) => (c.outerHTML || '')).join('');
    const cls = this.className ? ` class="${this.className}"` : '';
    return `<${this.tagName}${cls}>${this._html}${kids}</${this.tagName}>`;
  }
  get textContent() {
    const inner = this._html.replace(/<[^>]+>/g, '');
    return inner + this.childNodes.map((c) => c.textContent || '').join('');
  }
}
globalThis.document = { createElement: (tag) => new El(tag) };

const { whenWhereWatch } = await import('../../app/components/when-where-watch.js');

// A resolved KNOCKOUT schedule row: slot-style match_id, real team_a/team_b,
// kickoff/venue/broadcast all present (mirrors data/schedule_full.json).
const KO_ROW = {
  match_id: 'M080__1L__vs__3_EHIJK',
  match_number: 80,
  stage: 'round_of_32',
  team_a: 'USA',
  team_b: 'Italy',
  kickoff_utc: '2026-06-30T16:00:00Z',
  venue_id: 'mercedes',
  broadcast: { us: { english_channel: 'FOX', spanish_channel: 'Telemundo' } },
};
const VENUES = [{ id: 'mercedes', name: 'Mercedes-Benz Stadium', city: 'Atlanta' }];

test('knockout fixture (slot match_id) resolves kickoff + venue by team name', () => {
  const match = { team_a: 'USA', team_b: 'Italy', stage: 'round_of_32' };
  const node = whenWhereWatch(match, [KO_ROW], VENUES);
  const html = node.outerHTML;
  assert.doesNotMatch(html, /not yet assigned/, 'no "TBA" fallback — the row resolved');
  assert.match(html, /Kickoff/, 'renders a Kickoff row');
  assert.match(html, /Mercedes-Benz Stadium · Atlanta/, 'renders the resolved venue');
  assert.match(html, /watch-panel/, 'renders the full watch panel');
});

test('reversed team orientation still resolves (both orientations)', () => {
  const match = { team_a: 'Italy', team_b: 'USA', stage: 'round_of_32' };
  const node = whenWhereWatch(match, [KO_ROW], VENUES);
  assert.doesNotMatch(node.outerHTML, /not yet assigned/, 'reversed pair still resolves');
  assert.match(node.outerHTML, /Mercedes-Benz Stadium/, 'venue still found');
});

test('a genuinely unassigned fixture still shows the TBA fallback', () => {
  const match = { team_a: 'Ghana', team_b: 'Peru', stage: 'round_of_32' };
  const node = whenWhereWatch(match, [KO_ROW], VENUES);
  assert.match(node.outerHTML, /not yet assigned/, 'no matching row → TBA fallback');
});
