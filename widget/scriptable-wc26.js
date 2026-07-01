// scriptable-wc26.js — World Cup 2026 Home-Screen widget for the free
// Scriptable iOS app (https://apps.apple.com/us/app/scriptable/id1405459188).
//
// PWAs on iOS cannot ship a native Home-Screen widget, so this is the $0
// escape hatch: the user pastes this script into Scriptable and adds a widget.
// It fetches the site's PUBLIC data feeds (no auth, no key) and renders either
// the currently-LIVE match (with score) or the NEXT upcoming match (with local
// kickoff time). See docs/SIRI_AND_WIDGET.md for install + a Siri Shortcut.
//
// TWO-ENVIRONMENT DESIGN. The data-shaping is a PURE function, nextMatch(),
// with NO Scriptable API calls, so it is unit-tested under node:test and the
// whole file passes `node --check`. Everything that touches the Scriptable API
// (Request/ListWidget/Script/config) is behind a `typeof` guard that is false
// under Node, so importing this file in a test never executes widget code.
'use strict';

// Canonical site + feeds (public JSON, served with permissive CORS).
var BASE = 'https://worldcup2026.j5lagenticstrategy.com';
var SCHEDULE_URL = BASE + '/data/schedule_full.json';
var RESULTS_URL = BASE + '/data/actual_results.json';
var SITE_SCHEDULE_URL = BASE + '/#/schedule';

// ESPN/pipeline FINAL statuses — a match in one of these is settled (not "live"
// or "upcoming"). Mirrors app/lib/match-status.js so the widget agrees with the
// site about which games are done.
var FINAL_STATUSES = {
  STATUS_FINAL: 1, STATUS_FULL_TIME: 1, STATUS_END_OF_FULL_TIME: 1,
  STATUS_FINAL_AET: 1, STATUS_FINAL_PEN: 1,
};
// In-progress statuses ESPN reports mid-match.
var LIVE_STATUSES = {
  STATUS_IN_PROGRESS: 1, STATUS_HALFTIME: 1, STATUS_END_PERIOD: 1,
  STATUS_FIRST_HALF: 1, STATUS_SECOND_HALF: 1,
};

// ---------------------------------------------------------------------------
// PURE DATA SHAPING (unit-tested; no Scriptable API)
// ---------------------------------------------------------------------------

// Parse an ISO-8601 kickoff tolerant of a trailing 'Z' or a missing seconds
// field ("2026-06-11T19:00Z"). Returns a Date, or null on failure.
function parseKickoff(s) {
  if (!s || typeof s !== 'string') return null;
  var iso = s.trim();
  // "2026-06-11T19:00Z" (no seconds) → pad so Date parses everywhere.
  if (/T\d{2}:\d{2}Z$/.test(iso)) iso = iso.replace('Z', ':00Z');
  if (/T\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(iso)) {
    iso = iso.replace(/(T\d{2}:\d{2})([+-])/, '$1:00$2');
  }
  var d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// Flatten actual_results.json into a flat { match_id: record } map. The file is
// nested by round (group_stage / round_of_32 / …) each holding match records,
// plus scalar bookkeeping keys (last_updated). Tolerant of a flat map too.
function flattenResults(results) {
  var flat = {};
  if (!results || typeof results !== 'object') return flat;
  var rounds = Object.keys(results);
  for (var i = 0; i < rounds.length; i++) {
    var round = results[rounds[i]];
    if (!round || typeof round !== 'object') continue; // last_updated, etc.
    var ids = Object.keys(round);
    for (var j = 0; j < ids.length; j++) {
      var rec = round[ids[j]];
      // A round bucket holds objects keyed by match_id; a flat map holds the
      // same shape directly. Either way, a record has score_a / status.
      if (rec && typeof rec === 'object' &&
          ('score_a' in rec || 'status' in rec)) {
        flat[ids[j]] = rec;
      }
    }
  }
  return flat;
}

function statusOf(rec) {
  return (rec && typeof rec.status === 'string') ? rec.status : '';
}
function isFinal(rec) { return !!FINAL_STATUSES[statusOf(rec)]; }
function isLive(rec) {
  var st = statusOf(rec);
  return !!LIVE_STATUSES[st] || (!!st && !FINAL_STATUSES[st] &&
    st !== 'STATUS_SCHEDULED' && st.indexOf('STATUS_') === 0 &&
    (st.indexOf('HALF') >= 0 || st.indexOf('PROGRESS') >= 0 ||
     st.indexOf('PERIOD') >= 0));
}

// nextMatch(schedule, results, now) — the single pure decision the widget makes.
//   schedule : array of schedule_full.json rows (team_a/team_b/kickoff_utc/…)
//   results  : actual_results.json (nested-by-round OR flat map)
//   now      : Date (defaults to real now)
// Returns a normalized descriptor, or null when there is nothing to show:
//   { state: 'live'|'upcoming', match_id, team_a, team_b, kickoff, stage,
//     group, score_a?, score_b?, status? }
// Preference order: a LIVE match (soonest kickoff) beats the next UPCOMING one.
// A match is "upcoming" if it is not final and its kickoff is in the future
// (or within a 3h grace after kickoff with no result yet — covers a game that
// started but has no committed record). Deterministic given its inputs.
function nextMatch(schedule, results, now) {
  now = now instanceof Date ? now : new Date();
  var rows = Array.isArray(schedule) ? schedule : [];
  var flat = flattenResults(results);

  var live = [];
  var upcoming = [];
  var GRACE_MS = 3 * 60 * 60 * 1000; // treat a just-started game as live-ish

  for (var i = 0; i < rows.length; i++) {
    var m = rows[i];
    if (!m || !m.team_a || !m.team_b) continue;
    var mid = m.match_id || (m.team_a + '__vs__' + m.team_b);
    var ko = parseKickoff(m.kickoff_utc);
    var rec = flat[mid] || null;

    if (rec && isFinal(rec)) continue; // done — never "next"

    var base = {
      match_id: mid, team_a: m.team_a, team_b: m.team_b,
      kickoff: m.kickoff_utc || null,
      kickoffDate: ko,
      stage: m.stage || null, group: m.group || null,
    };

    if (rec && isLive(rec)) {
      base.state = 'live';
      base.status = statusOf(rec);
      if (typeof rec.score_a === 'number') base.score_a = rec.score_a;
      if (typeof rec.score_b === 'number') base.score_b = rec.score_b;
      if (rec.minute != null) base.minute = String(rec.minute);
      live.push(base);
      continue;
    }

    if (ko) {
      var delta = ko.getTime() - now.getTime();
      if (delta >= 0) {
        base.state = 'upcoming';
        upcoming.push(base);
      } else if (delta >= -GRACE_MS && rec) {
        // Kicked off recently, has a (non-final) record but no live status →
        // still surface it as live so the widget isn't blank at kickoff.
        base.state = 'live';
        base.status = statusOf(rec) || 'STATUS_IN_PROGRESS';
        if (typeof rec.score_a === 'number') base.score_a = rec.score_a;
        if (typeof rec.score_b === 'number') base.score_b = rec.score_b;
        live.push(base);
      }
    }
  }

  var pick = null;
  if (live.length) {
    live.sort(function (a, b) { return koMs(a) - koMs(b); });
    pick = live[0];
  } else if (upcoming.length) {
    upcoming.sort(function (a, b) { return koMs(a) - koMs(b); });
    pick = upcoming[0];
  }
  if (!pick) return null;
  // Drop the internal Date field from the returned descriptor (JSON-clean).
  var out = {};
  for (var k in pick) { if (k !== 'kickoffDate') out[k] = pick[k]; }
  return out;
}

function koMs(x) {
  return (x && x.kickoffDate instanceof Date) ? x.kickoffDate.getTime() : Infinity;
}

// Format a kickoff Date as a short local string, e.g. "Sat 3:00 PM". Pure.
function formatKickoff(isoStr) {
  var d = parseKickoff(isoStr);
  if (!d) return '';
  try {
    var day = d.toLocaleDateString(undefined, { weekday: 'short' });
    var time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return day + ' ' + time;
  } catch (_e) {
    return d.toISOString();
  }
}

// ---------------------------------------------------------------------------
// SCRIPTABLE RUNTIME (guarded — never runs under Node / node:test)
// ---------------------------------------------------------------------------

async function fetchJSON(url) {
  // eslint-disable-next-line no-undef
  var req = new Request(url);
  req.timeoutInterval = 15;
  return await req.loadJSON();
}

function buildWidget(pick) {
  // eslint-disable-next-line no-undef
  var w = new ListWidget();
  w.setPadding(14, 14, 14, 14);
  // eslint-disable-next-line no-undef
  w.backgroundColor = new Color('#0b1220');
  w.url = SITE_SCHEDULE_URL; // tap the widget → open the schedule

  var header = w.addText('WORLD CUP 2026');
  header.font = Font.mediumSystemFont(9);
  // eslint-disable-next-line no-undef
  header.textColor = new Color('#7c8db5');
  w.addSpacer(6);

  if (!pick) {
    var none = w.addText('No upcoming match');
    none.font = Font.semiboldSystemFont(15);
    // eslint-disable-next-line no-undef
    none.textColor = new Color('#e8eefc');
    w.addSpacer(4);
    var sub = w.addText('Tap to open the tracker');
    sub.font = Font.systemFont(11);
    // eslint-disable-next-line no-undef
    sub.textColor = new Color('#7c8db5');
    return w;
  }

  var live = pick.state === 'live';
  var badge = w.addText(live ? '● LIVE' : 'NEXT MATCH');
  badge.font = Font.boldSystemFont(10);
  // eslint-disable-next-line no-undef
  badge.textColor = new Color(live ? '#ff5a5a' : '#4ade80');
  w.addSpacer(6);

  var ta = w.addText(pick.team_a);
  ta.font = Font.semiboldSystemFont(16);
  // eslint-disable-next-line no-undef
  ta.textColor = new Color('#e8eefc');
  var tb = w.addText(pick.team_b);
  tb.font = Font.semiboldSystemFont(16);
  // eslint-disable-next-line no-undef
  tb.textColor = new Color('#e8eefc');
  w.addSpacer(6);

  if (live && (pick.score_a != null || pick.score_b != null)) {
    var sc = w.addText((pick.score_a != null ? pick.score_a : '-') + ' – ' +
      (pick.score_b != null ? pick.score_b : '-') +
      (pick.minute ? '   ' + pick.minute + "'" : ''));
    sc.font = Font.boldSystemFont(18);
    // eslint-disable-next-line no-undef
    sc.textColor = new Color('#ffd95a');
  } else {
    var when = w.addText(formatKickoff(pick.kickoff) || 'Kickoff TBD');
    when.font = Font.mediumSystemFont(13);
    // eslint-disable-next-line no-undef
    when.textColor = new Color('#a9b8dd');
  }
  return w;
}

async function run() {
  var schedule = [];
  var results = {};
  try { schedule = await fetchJSON(SCHEDULE_URL); } catch (_e) { schedule = []; }
  try { results = await fetchJSON(RESULTS_URL); } catch (_e) { results = {}; }

  var pick = nextMatch(schedule, results, new Date());
  var widget = buildWidget(pick);

  // eslint-disable-next-line no-undef
  if (typeof config !== 'undefined' && config.runsInWidget) {
    // eslint-disable-next-line no-undef
    Script.setWidget(widget);
  } else {
    // In-app preview when run manually.
    await widget.presentMedium();
  }
  // eslint-disable-next-line no-undef
  Script.complete();
}

// Only touch the Scriptable API when it actually exists. Under Node (node:test
// via a CommonJS vm sandbox, or `node --check`) these globals are undefined, so
// we export the pure helpers instead of executing any widget code. `module` is
// only defined when this file is loaded in a CommonJS context (our test's vm
// sandbox); Scriptable ignores the export.
var _HELPERS = {
  nextMatch: nextMatch,
  flattenResults: flattenResults,
  parseKickoff: parseKickoff,
  formatKickoff: formatKickoff,
  isFinal: isFinal,
  isLive: isLive,
  FINAL_STATUSES: FINAL_STATUSES,
};
if (typeof ListWidget !== 'undefined' && typeof Request !== 'undefined') {
  run();
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = _HELPERS;
}
