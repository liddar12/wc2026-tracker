/* match-insights.test.mjs — June-11 night fixes:
   1) lineups scraper rewritten to ESPN summary rosters (+ __meta__ freshness)
   2) new match-events scraper (goals + cards) + matchEvents feed
   3) team_colors gains __meta__ + is loaded by data-loader (fixes "never")
   4) matchup-detail shows the score + events/discipline + tappable team links */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const J = (p) => JSON.parse(read(p));

test('lineups scraper uses ESPN summary rosters and stamps __meta__', () => {
  const s = read('scripts/scrape_lineups.py');
  assert.match(s, /\/summary/, 'summary endpoint');
  assert.match(s, /starter/, 'reads starter flags');
  assert.match(s, /__meta__/, 'stamps freshness');
  // live data populated by the rewrite (opener)
  const lu = J('data/lineups.json');
  assert.ok(lu.__meta__?.updated_at, 'lineups has freshness meta');
  const opener = lu['Mexico__vs__South Africa'];
  assert.ok(opener?.team_a?.xi?.length === 11, 'Mexico starting XI captured');
});

test('match-events scraper outputs goals + cards with canonical team names', () => {
  const s = read('scripts/scrape_match_events.py');
  assert.match(s, /keyEvents/, 'reads ESPN keyEvents');
  assert.match(s, /Yellow Card/, 'maps yellow cards');
  const ev = J('data/match_events.json');
  assert.ok(ev.__meta__?.updated_at, 'events meta present');
  const opener = ev['Mexico__vs__South Africa'];
  assert.ok(opener?.events?.length >= 3, 'opener has events');
  assert.ok(opener.events.some((e) => e.type === 'yellow'), 'cards captured');
  assert.ok(opener.events.some((e) => e.type === 'goal'), 'goals captured');
});

test('data-loader serves teamColors + matchEvents; freshness rows wired', () => {
  const dl = read('app/data-loader.js');
  assert.match(dl, /team_colors\.json/, 'team colors loaded');
  assert.match(dl, /match_events\.json/, 'events loaded');
  assert.match(dl, /'teamColors'/, 'teamColors key');
  assert.match(dl, /'matchEvents'/, 'matchEvents key');
  const tc = J('data/team_colors.json');
  assert.ok(tc.__meta__?.updated_at, 'team_colors stamped (fixes "never")');
  const hv = read('app/views/home-view.js');
  assert.match(hv, /matchEvents\?\.__meta__/, 'popover has Match events row');
});

test('matchup-detail: header score, events section, tappable team links', () => {
  const md = read('app/views/matchup-detail.js');
  assert.match(md, /actualForCard\(data\.actualResults/, 'looks up the real result');
  assert.match(md, /data-testid="detail-score"/, 'renders the score between teams');
  assert.match(md, /matchEventsSection\(match, data\.matchEvents\)/, 'events section wired');
  const css = read('app/styles.css');
  assert.match(css, /a\.team-link strong \{/, 'team-link affordance styled');
  assert.match(css, /\.detail-score \{/, 'score styled');
  const ev = read('app/components/match-events.js');
  assert.match(ev, /tournament: \$\{t\.yellow\}/, 'discipline shows tournament card totals');
});

test('crons run the new scrapers', () => {
  const live = read('.github/workflows/live_update.yml');
  assert.match(live, /scrape_match_events\.py/);
  assert.match(live, /scrape_lineups\.py/, 'live cron backfills lineups');
  assert.match(read('.github/workflows/pre_kickoff_update.yml'), /scrape_match_events\.py/);
  assert.match(read('.github/workflows/frequent_update.yml'), /scrape_match_events\.py/);
});
