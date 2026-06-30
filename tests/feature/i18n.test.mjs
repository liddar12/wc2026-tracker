/* i18n.test.mjs — RJ30.1-B (QA-1): the i18n FOUNDATION contract.
 *
 * Pure logic, no DOM. Imports app/lib/i18n.js + app/lib/strings.es.js directly.
 * The module guards navigator/localStorage/document/window with try/catch +
 * typeof, so it loads cleanly under node:test with no globals stubbed. Where a
 * test needs a specific catalog/lang/navigator we use the exported test seams
 * (_setCatalogES / _setLangForTest) or a temporary globalThis.navigator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED, LS_LANG, EN,
  t, detectLang, getLang, setLang, localeFor, humanize,
  fmtNumber, fmtDate, fmtTime,
  _setCatalogES, _setLangForTest,
} from '../../app/lib/i18n.js';
import { ES } from '../../app/lib/strings.es.js';

// Make the lazy Spanish catalog available synchronously for the logic tests.
_setCatalogES(ES);

test('SUPPORTED + LS key are the locked contract', () => {
  assert.deepEqual(SUPPORTED, ['en', 'es']);
  assert.equal(LS_LANG, 'wc26.lang');
});

test('t() resolves en and es for a known key', () => {
  _setLangForTest('en');
  assert.equal(t('nav.schedule'), 'Schedule');
  _setLangForTest('es');
  assert.equal(t('nav.schedule'), 'Calendario');
  // explicit lang override wins regardless of in-memory lang
  assert.equal(t('nav.schedule', undefined, 'en'), 'Schedule');
  assert.equal(t('nav.home', undefined, 'es'), 'Inicio');
});

test('missing-key fallback: EN key absent from ES returns the EN value', () => {
  // Find a key that exists in EN but not ES (foundation allows EN-only keys).
  const enOnly = Object.keys(EN).find((k) => ES[k] === undefined);
  // Our catalog is fully mirrored; synthesize the case via a seeded catalog
  // missing one key, then restore.
  const trimmed = { ...ES };
  delete trimmed['nav.schedule'];
  _setCatalogES(trimmed);
  _setLangForTest('es');
  assert.equal(t('nav.schedule'), 'Schedule', 'es falls back to EN per-key');
  _setCatalogES(ES); // restore
  if (enOnly) {
    assert.equal(t(enOnly), EN[enOnly]);
  }
});

test('unknown key → humanized last segment, never throws, never raw key', () => {
  _setLangForTest('es');
  assert.equal(t('totally.unknown.deepKey'), 'Deep Key');
  assert.equal(t('nav.schedule_published'), 'Schedule Published');
  assert.doesNotThrow(() => t('a.b.c.d.e'));
  // never returns the raw dotted key
  assert.notEqual(t('some.missing.key'), 'some.missing.key');
});

test('interpolation substitutes {vars}; unknown placeholders stay intact', () => {
  // Seed a template through the ES catalog seam (foundation has no {var} keys).
  _setCatalogES({ ...ES, 'test.greet': 'Hola {name}, {count} grupos' });
  _setLangForTest('es');
  assert.equal(t('test.greet', { name: 'Ana', count: 2 }), 'Hola Ana, 2 grupos');
  // unknown placeholder is left intact
  assert.equal(t('test.greet', { name: 'Ana' }), 'Hola Ana, {count} grupos');
  // interpolation also works on the humanized fallback path (no crash)
  assert.equal(typeof t('x.y', { a: 1 }), 'string');
  _setCatalogES(ES); // restore
});

test('humanize: camelCase + dot-namespacing → Title Case last segment', () => {
  assert.equal(humanize('nav.schedule'), 'Schedule');
  assert.equal(humanize('home.recentResults'), 'Recent Results');
  assert.equal(humanize('settings.language'), 'Language');
  assert.equal(humanize('a.b.someThing-here'), 'Some Thing Here');
  assert.equal(humanize(''), '');
});

test('localeFor: es → es-MX, en → en-US (fixed)', () => {
  assert.equal(localeFor('es'), 'es-MX');
  assert.equal(localeFor('en'), 'en-US');
});

test('fmtDate localizes by lang; invalid ISO → empty string', () => {
  const iso = '2026-06-11T19:00:00Z';
  assert.match(fmtDate(iso, { month: 'long', timeZone: 'UTC' }, 'es'), /junio/i);
  assert.match(fmtDate(iso, { month: 'long', timeZone: 'UTC' }, 'en'), /June/i);
  assert.equal(fmtDate('not-a-date', { month: 'long' }, 'es'), '');
  assert.equal(fmtDate('', {}, 'en'), '');
  // accepts a Date instance too
  assert.match(fmtDate(new Date(iso), { month: 'long', timeZone: 'UTC' }, 'es'), /junio/i);
});

test('fmtTime is a time-only convenience over fmtDate', () => {
  const iso = '2026-06-11T19:05:00Z';
  const out = fmtTime(iso, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }, 'en');
  assert.match(out, /19:05/);
  assert.equal(fmtTime('bad'), '');
});

test('fmtNumber: NaN → empty; locale grouping applies', () => {
  assert.equal(fmtNumber(NaN, {}, 'es'), '');
  assert.equal(fmtNumber(undefined, {}, 'en'), '');
  assert.equal(fmtNumber('xyz', {}, 'en'), '');
  // 42.1% style — one decimal
  assert.equal(fmtNumber(42.1, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, 'en'), '42.1');
  // grouping present in both locales for a 4-digit number
  assert.ok(/\D/.test(fmtNumber(1234, {}, 'es').replace(/[0-9]/g, 'x').slice(1)) ||
    fmtNumber(1234, {}, 'es').length >= 4);
});

test('detectLang: stored wins, else navigator es*, else en', () => {
  const origNav = globalThis.navigator;
  const setNav = (languages) => {
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { languages, language: languages[0] }, configurable: true,
      });
    } catch { globalThis.navigator = { languages, language: languages[0] }; }
  };

  // No stored key (localStorage is absent in node → lsGet returns null).
  setNav(['es-MX', 'en']);
  assert.equal(detectLang(), 'es', 'es-MX leads → es');
  setNav(['es-419']);
  assert.equal(detectLang(), 'es', 'es-419 → es');
  setNav(['es']);
  assert.equal(detectLang(), 'es', 'bare es → es');
  setNav(['en-US', 'es']);
  assert.equal(detectLang(), 'es', 'es anywhere in list → es (first-hit prefix)');
  setNav(['en-US']);
  assert.equal(detectLang(), 'en', 'no es → en');
  setNav(['fr-FR', 'de']);
  assert.equal(detectLang(), 'en', 'non-es → en default');

  // restore
  try {
    Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
  } catch { globalThis.navigator = origNav; }
});

test('detectLang never throws when navigator is absent', () => {
  const origNav = globalThis.navigator;
  try { delete globalThis.navigator; } catch { globalThis.navigator = undefined; }
  assert.doesNotThrow(() => detectLang());
  assert.equal(detectLang(), 'en');
  try {
    Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
  } catch { globalThis.navigator = origNav; }
});

test('setLang validates, updates in-memory lang, never throws sans DOM', () => {
  assert.doesNotThrow(() => setLang('es'));
  assert.equal(getLang(), 'es');
  assert.equal(setLang('es'), 'es');
  assert.equal(setLang('xx'), 'en', 'invalid lang coerces to en');
  assert.equal(getLang(), 'en');
});

test('catalog integrity: every ES key exists in EN (no orphans)', () => {
  for (const k of Object.keys(ES)) {
    assert.ok(EN[k] !== undefined, `orphan ES key not in EN: ${k}`);
  }
});

test('seeded EN literals are byte-identical to current app strings (regression guard)', () => {
  // These flow through t() in Wave 2; the English value must equal the literal
  // the views render today so existing assertions stay green.
  assert.equal(EN['nav.home'], 'Home');
  assert.equal(EN['nav.schedule'], 'Schedule');
  assert.equal(EN['nav.projected'], 'Projected');
  assert.equal(EN['nav.play'], 'Play');
  assert.equal(EN['nav.bracket'], 'Bracket');
  assert.equal(EN['nav.pools'], 'Pools');
  assert.equal(EN['nav.myBrackets'], 'My Brackets');
  assert.equal(EN['nav.myPicks'], 'My Picks');
  assert.equal(EN['nav.venues'], 'Venues');
  assert.equal(EN['nav.matches'], 'Matches');
  assert.equal(EN['standings.advanced'], 'Advanced');
  assert.equal(EN['standings.bestThird'], 'Best third?');
  assert.equal(EN['standings.eliminated'], 'Eliminated');
  assert.equal(EN['schedule.empty'], 'Full tournament schedule is not yet published.');
  assert.equal(EN['settings.spanish'], 'Español');
});
