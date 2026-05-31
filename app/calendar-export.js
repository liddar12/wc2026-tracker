/* calendar-export.js — A5: export the favorite team's full fixture list
   (group + knockout pathways) as an .ics calendar file. Each match becomes
   a 2-hour VEVENT in the user's local calendar app. */

const ICS_PRODID = '-//WC26 Tracker//Bracket//EN';

export function buildIcsForTeam(data, teamName) {
  const matches = collectTeamMatches(data, teamName);
  if (!matches.length) return null;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:WC26 — ${teamName}`,
    `X-WR-CALDESC:Fixtures for ${teamName} at the 2026 FIFA World Cup`,
  ];
  for (const m of matches) {
    const ev = buildVevent(m, teamName);
    if (ev) lines.push(...ev);
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function collectTeamMatches(data, team) {
  const sf = data?.scheduleFull || [];
  const out = [];
  for (const m of sf) {
    if (m.team_a === team || m.team_b === team) out.push(m);
    // Knockout slots resolved to placeholders still might reference the team
    // via projected_winner if available; skip those — we want fixed kickoffs.
  }
  return out.sort((a, b) => String(a.kickoff_utc).localeCompare(String(b.kickoff_utc)));
}

function buildVevent(match, team) {
  if (!match.kickoff_utc) return null;
  const start = parseUtc(match.kickoff_utc);
  if (!start) return null;
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const oppRaw = match.team_a === team ? match.team_b : match.team_a;
  const opp = oppRaw || 'TBD';
  const venue = [match.venue, match.city].filter(Boolean).join(', ');
  const stage = prettyStage(match.stage);
  const summary = `${team} vs ${opp}${stage ? ` (${stage})` : ''}`;
  const uid = `wc26-${match.match_number || `${team}-${opp}-${match.kickoff_utc}`}@wc26-tracker`;
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `LOCATION:${escapeIcs(venue)}`,
    `DESCRIPTION:${escapeIcs(`Match ${match.match_number || ''} · ${stage}\\nBroadcast info: see WC26 tracker for the latest.`)}`,
    'END:VEVENT',
  ];
}

function prettyStage(stage) {
  if (!stage) return '';
  return stage
    .replace(/^group_stage$/, 'Group Stage')
    .replace(/^round_of_32$/, 'Round of 32')
    .replace(/^round_of_16$/, 'Round of 16')
    .replace(/^quarterfinals$/, 'Quarterfinals')
    .replace(/^semifinals$/, 'Semifinals')
    .replace(/^third_place$/, 'Third-place playoff')
    .replace(/^final$/, 'Final');
}

function parseUtc(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatUtc(d) {
  // YYYYMMDDTHHMMSSZ
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeIcs(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function downloadIcsForTeam(data, teamName) {
  const ics = buildIcsForTeam(data, teamName);
  if (!ics) return false;
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wc26-${teamName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
