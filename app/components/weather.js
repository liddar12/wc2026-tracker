import { escapeHtml } from '../lib/escape.js';
/* weather.js — kickoff-day forecast for the venue. */

const WEATHER_DESC = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
  82: 'Violent rain showers', 95: 'Thunderstorm',
  96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ heavy hail'
};

export function weatherSection(match, scheduleFull, weather) {
  const sec = document.createElement('div');
  sec.className = 'section';
  sec.innerHTML = '<h2>Weather</h2>';

  // Match by match_id first (group/named rows), then fall back to the resolved
  // team pair. Knockout rows keep a placeholder match_id (e.g. "M084__1H__vs__2J")
  // even after team_a/team_b are filled in, so a team-pair match is needed to
  // surface the venue for a resolved knockout fixture.
  const a = match.team_a;
  const b = match.team_b;
  const row = (scheduleFull || []).find((r) =>
    r.match_id === `${a}__vs__${b}` || r.match_id === `${b}__vs__${a}`
    || (r.team_a === a && r.team_b === b)
    || (r.team_a === b && r.team_b === a));
  if (!row || !row.venue_id || !row.kickoff_utc) {
    sec.appendChild(emptyLine('No venue assigned — weather unavailable.'));
    return sec;
  }
  // Key by the VENUE-LOCAL match day (the scraper keys forecasts the same way,
  // by kickoff_local_venue) so a late-UTC kickoff resolves to the right day.
  const date = (row.kickoff_local_venue || row.kickoff_utc).slice(0, 10);
  const block = (weather || {})[row.venue_id] || {};
  const w = block[date];
  if (!w) {
    sec.appendChild(emptyLine('Forecast not yet available (>15 days out).'));
    return sec;
  }
  const desc = WEATHER_DESC[w.condition_code] || 'Forecast';
  const tempF = typeof w.temp_c === 'number' ? Math.round(w.temp_c * 9 / 5 + 32) : null;
  const body = document.createElement('div');
  body.className = 'weather-block';
  body.innerHTML = `
    <div class="kv"><span class="k">Forecast</span><span class="v">${escapeHtml(desc)}</span></div>
    <div class="kv"><span class="k">Temperature</span><span class="v">${typeof w.temp_c === 'number' ? `${w.temp_c.toFixed(0)}°C / ${tempF}°F` : '?'}</span></div>
    <div class="kv"><span class="k">Humidity</span><span class="v">${typeof w.humidity_pct === 'number' ? `${w.humidity_pct.toFixed(0)}%` : '?'}</span></div>
    <div class="kv"><span class="k">Wind</span><span class="v">${typeof w.wind_kph === 'number' ? `${w.wind_kph.toFixed(0)} km/h` : '?'}</span></div>
  `;
  sec.appendChild(body);
  return sec;
}

function emptyLine(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}

