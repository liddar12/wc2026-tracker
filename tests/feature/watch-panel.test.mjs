import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('watch panel: both languages, deep-linked stream buttons, vMVPDs', () => {
  const s = read('app/components/when-where-watch.js');
  assert.match(s, /watch-panel/, 'renders a watch panel');
  assert.match(s, />English</);
  assert.match(s, />Español</);
  // clickable, deep-linked services
  for (const url of ['foxsports.com/live', 'peacocktv.com', 'tubitv.com', 'telemundodeportes.com']) {
    assert.ok(s.includes(url), `links ${url}`);
  }
  // vMVPD "also on" carriers
  for (const v of ['YouTube TV', 'Fubo', 'Sling', 'DirecTV']) {
    assert.ok(s.includes(v), `lists ${v}`);
  }
  assert.match(s, /target="_blank"/, 'opens streams in a new tab');
});

test('watch panel: FREE-on-Tubi only for the announced free matches', () => {
  const s = read('app/components/when-where-watch.js');
  assert.match(s, /TUBI_FREE\s*=\s*new Set\(\[1,\s*4\]\)/, 'free set = matches 1 and 4 (no "Tubi on all")');
  assert.match(s, /watch-free/, 'free matches get a FREE badge');
  assert.match(s, /TUBI_FREE\.has\(row\.match_number\)/, 'free badge gated by match number');
});

test('watch panel: exact channel chips + live state', () => {
  const s = read('app/components/when-where-watch.js');
  assert.match(s, /chan-\$\{key\}/, 'builds a channel-specific chip class');
  assert.match(s, /channelName/, 'strips the scraper stream suffix to a clean channel');
  assert.match(s, /liveState|watch-live/, 'has a LIVE state tied to kickoff');
  // CSS present (chip color classes live here, built dynamically in JS)
  const css = read('app/styles.css');
  assert.match(css, /\.watch-panel\b/, 'watch-panel styled');
  assert.match(css, /\.watch-btn\b/, 'watch buttons styled');
  assert.match(css, /\.chan-fox\b/, 'channel chip colors (fox/fs1/tel/uni)');
});
