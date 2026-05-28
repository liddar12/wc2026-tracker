/* when-where-watch.js — section for kickoff local time + venue + US broadcast. */

export function whenWhereWatch(match, scheduleFull, venues) {
  const section = document.createElement('div');
  section.className = 'section';
  section.innerHTML = '<h2>When &amp; where &amp; how to watch</h2>';

  const row = (scheduleFull || []).find((r) => r.match_id === `${match.team_a}__vs__${match.team_b}` || r.match_id === `${match.team_b}__vs__${match.team_a}`);
  const venue = row && (venues || []).find((v) => v.id === row.venue_id);
  const body = document.createElement('div');
  body.className = 'when-where-watch';

  if (!row) {
    body.innerHTML = '<p class="muted">Kickoff time + venue not yet assigned.</p>';
    section.appendChild(body);
    return section;
  }

  const localTime = formatLocal(row.kickoff_utc);
  const broadcast = row.broadcast?.us || {};
  body.innerHTML = `
    <div class="kv"><span class="k">Kickoff</span><span class="v">${escapeHtml(localTime)}</span></div>
    <div class="kv"><span class="k">Venue</span><span class="v">${escapeHtml(venue ? `${venue.name} · ${venue.city}` : 'Venue TBA')}</span></div>
    <div class="kv"><span class="k">English (US)</span><span class="v">${escapeHtml(broadcast.english_channel || 'Channel TBA')}</span></div>
    <div class="kv"><span class="k">Spanish (US)</span><span class="v">${escapeHtml(broadcast.spanish_channel || 'Channel TBA')}</span></div>
    ${broadcast.stream_url
      ? `<div class="kv"><span class="k">Stream</span><span class="v"><a href="${escapeAttr(broadcast.stream_url)}" rel="noopener noreferrer">Watch live</a></span></div>`
      : ''}
  `;
  section.appendChild(body);
  return section;
}

function formatLocal(iso) {
  if (!iso) return 'Kickoff TBA';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const dateStr = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(d);
    const timeStr = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(d);
    const tz = (Intl.DateTimeFormat(undefined).resolvedOptions().timeZone || '').split('/').pop();
    return `${dateStr} · ${timeStr}${tz ? ' ' + tz : ''}`;
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
