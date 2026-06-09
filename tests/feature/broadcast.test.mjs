import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const read = (p) => readFileSync(p, 'utf8');

test('every match has US broadcast + streaming (no "TBA")', () => {
  const sched = json('data/schedule_full.json');
  const rows = Array.isArray(sched) ? sched : sched.matches;
  let n = 0;
  for (const m of rows) {
    const us = m.broadcast?.us || {};
    assert.ok(us.english_channel, `english_channel set (${m.team_a} v ${m.team_b})`);
    assert.ok(us.spanish_channel, 'spanish_channel set');
    assert.match(us.english_channel, /FOX|FS1/, 'English = FOX family');
    assert.match(us.spanish_channel, /Telemundo|Universo/, 'Spanish = Telemundo family');
    n++;
  }
  assert.ok(n >= 100, `all matches covered (${n})`);
});

test('scrape_broadcast.py: accurate defaults + overrides hook', () => {
  const s = read('scripts/scrape_broadcast.py');
  assert.match(s, /FOX \/ FS1/, 'FOX/FS1 English default');
  assert.match(s, /Telemundo \/ Universo/, 'Telemundo/Universo Spanish default');
  assert.match(s, /Tubi/, 'Tubi free stream');
  assert.match(s, /broadcast_overrides\.json/, 'reads per-match overrides');
  const ov = json('data/broadcast_overrides.json');
  assert.ok(ov.by_match && typeof ov.by_match === 'object', 'overrides has by_match');
});

test('scrape_broadcast.py: kickoff fallback fills placeholder/knockout matches safely', () => {
  const s = read('scripts/scrape_broadcast.py');
  assert.match(s, /def iso2epoch/, 'tolerant ISO→epoch parser');
  assert.match(s, /by_kick/, 'builds a kickoff-keyed index for team-unmatched rows');
  // only unambiguous (single-event) timestamps are usable → can add, never mislabel
  assert.match(s, /len\(lst\) == 1/, 'drops ambiguous (simultaneous) timestamps');
  // team-set match keeps precedence; kickoff fallback only runs in the else branch
  assert.match(s, /if key in espn:[\s\S]*?else:[\s\S]*?ep in by_kick/, 'kickoff fallback is additive (team match wins)');
});
