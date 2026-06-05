import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/styles.css', 'utf8');
const myPicks = readFileSync('app/views/my-picks.js', 'utf8');
const home = readFileSync('app/views/home-view.js', 'utf8');

test('R17 #5b: --picked token (#15803D) defined for light + dark themes', () => {
  const defs = css.match(/--picked:\s*#15803D/gi) || [];
  assert.ok(defs.length >= 2, `--picked: #15803D should be defined in both themes (found ${defs.length})`);
  assert.match(css, /--picked-ink:\s*#ffffff/i, '--picked-ink defined');
});

test('R17 #5b: the three .is-picked rules use --picked (not --primary/--good)', () => {
  for (const sel of ['.pick-btn.is-picked', '.bb-slot.is-picked', '.pw-bracket-side.is-picked']) {
    const i = css.indexOf(sel);
    assert.ok(i > -1, `${sel} present`);
    const block = css.slice(i, css.indexOf('}', i));
    assert.match(block, /var\(--picked/, `${sel} should reference --picked`);
    assert.doesNotMatch(block, /var\(--primary\b/, `${sel} should no longer use --primary`);
  }
});

test('R17 #2b: Everyone-leaderboard freshness note gated on EVERYONE_GROUP_ID', () => {
  for (const [name, src] of [['my-picks', myPicks], ['home-view', home]]) {
    assert.match(src, /EVERYONE_GROUP_ID/, `${name} imports/uses EVERYONE_GROUP_ID`);
    assert.match(src, /Scores update as matches are played/, `${name} has the freshness note`);
  }
});
