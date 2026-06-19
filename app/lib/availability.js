/* availability.js — player availability from match events (suspensions).
   ESPN publishes no WC injury data (see docs/POSTMORTEM_2026-06-19.md), so
   suspensions are the only reliable automated availability signal:
     • a red card → banned for the team's NEXT match
     • two accumulated yellows (across matches) → one-match ban
   Shared by the Injuries page (tournament-wide list) and the matchup view
   (who is unavailable for THIS specific match). */

function sortedSchedule(data) {
  return (data?.scheduleFull || []).slice()
    .sort((a, b) => String(a.kickoff_utc).localeCompare(String(b.kickoff_utc)));
}

function kickoffOfKey(sched, key) {
  const m = sched.find((x) => `${x.team_a}__vs__${x.team_b}` === key || `${x.team_b}__vs__${x.team_a}` === key);
  return m ? m.kickoff_utc : '';
}

function nextMatchAfter(sched, team, afterKickoff) {
  return sched.find((m) => (m.team_a === team || m.team_b === team)
    && String(m.kickoff_utc) > String(afterKickoff)) || null;
}

/** Walk all match events chronologically → [{player, team, reason, banMatchId}],
 *  one entry per ban (the match the player must sit out). */
function banEvents(data) {
  const me = data?.matchEvents || {};
  const sched = sortedSchedule(data);
  const keys = Object.keys(me)
    .filter((k) => k !== '__meta__' && Array.isArray(me[k]?.events))
    .sort((a, b) => String(kickoffOfKey(sched, a)).localeCompare(String(kickoffOfKey(sched, b))));
  const yellow = {};
  const bans = [];
  for (const key of keys) {
    const koff = kickoffOfKey(sched, key);
    for (const e of me[key].events) {
      if (!e.player) continue;
      if (e.type === 'red') {
        const nm = nextMatchAfter(sched, e.team, koff);
        if (nm) bans.push({ player: e.player, team: e.team, reason: '🟥 red card', banMatchId: `${nm.team_a}__vs__${nm.team_b}` });
      } else if (e.type === 'yellow') {
        yellow[e.player] = (yellow[e.player] || 0) + 1;
        if (yellow[e.player] % 2 === 0) {
          const nm = nextMatchAfter(sched, e.team, koff);
          if (nm) bans.push({ player: e.player, team: e.team, reason: '🟨×2 accumulated', banMatchId: `${nm.team_a}__vs__${nm.team_b}` });
        }
      }
    }
  }
  return bans;
}

/** Players suspended for THIS match → { team_a: [{player, reason}], team_b: [...] }. */
export function suspendedForMatch(data, match) {
  const out = { team_a: [], team_b: [] };
  if (!match?.team_a || !match?.team_b) return out;
  const ids = new Set([`${match.team_a}__vs__${match.team_b}`, `${match.team_b}__vs__${match.team_a}`]);
  const seen = new Set();
  for (const b of banEvents(data)) {
    if (!ids.has(b.banMatchId) || seen.has(b.player)) continue;
    seen.add(b.player);
    if (b.team === match.team_a) out.team_a.push(b);
    else if (b.team === match.team_b) out.team_b.push(b);
  }
  return out;
}

/** Tournament-wide suspension list for the Injuries page →
 *  [{player, team, reason, misses}] (one per player, red takes precedence). */
export function suspensions(data) {
  const sched = sortedSchedule(data);
  const seen = new Set();
  const out = [];
  for (const b of banEvents(data)) {
    if (seen.has(b.player)) continue;
    seen.add(b.player);
    const nm = sched.find((m) => `${m.team_a}__vs__${m.team_b}` === b.banMatchId);
    const opp = nm ? (nm.team_a === b.team ? nm.team_b : nm.team_a) : '';
    out.push({ player: b.player, team: b.team, reason: b.reason, misses: opp ? `vs ${opp}` : '' });
  }
  return out;
}
