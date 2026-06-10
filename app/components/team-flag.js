/* team-flag.js — country name -> emoji flag.
 * Uses regional-indicator pairs from ISO-3166 alpha-2 codes; falls back to globe.
 */

const ISO = {
  'USA': 'US', 'United States': 'US',
  'Canada': 'CA',
  'Mexico': 'MX',
  'Argentina': 'AR',
  'Brazil': 'BR',
  'France': 'FR',
  'Germany': 'DE',
  'Spain': 'ES',
  'Portugal': 'PT',
  'Netherlands': 'NL',
  'England': 'GB-ENG',
  'Italy': 'IT',
  'Belgium': 'BE',
  'Croatia': 'HR',
  'Switzerland': 'CH',
  'Denmark': 'DK',
  'Poland': 'PL',
  'Czechia': 'CZ',
  'Norway': 'NO',
  'Sweden': 'SE',
  'Türkiye': 'TR', 'Turkiye': 'TR', 'Turkey': 'TR',
  'Serbia': 'RS',
  'Austria': 'AT',
  'Hungary': 'HU',
  'Scotland': 'GB-SCT',
  'Wales': 'GB-WLS',
  'Republic of Ireland': 'IE', 'Ireland': 'IE',
  'Ukraine': 'UA',
  'Greece': 'GR',
  'Albania': 'AL',
  'Romania': 'RO',
  'Slovenia': 'SI',
  'Slovakia': 'SK',
  'Bosnia and Herzegovina': 'BA',
  'Senegal': 'SN',
  'Morocco': 'MA',
  'Tunisia': 'TN',
  'Algeria': 'DZ',
  'Egypt': 'EG',
  'Nigeria': 'NG',
  'Ghana': 'GH',
  "Côte d'Ivoire": 'CI', "Cote d'Ivoire": 'CI', 'Cote d Ivoire': 'CI', 'Ivory Coast': 'CI',
  'Cameroon': 'CM',
  'DR Congo': 'CD', 'Congo DR': 'CD',
  'South Africa': 'ZA',
  'Mali': 'ML',
  'Burkina Faso': 'BF',
  'Cape Verde': 'CV', 'Cabo Verde': 'CV',
  'Japan': 'JP',
  'Korea Republic': 'KR', 'South Korea': 'KR',
  'Australia': 'AU',
  'Iran': 'IR', 'IR Iran': 'IR',
  'Saudi Arabia': 'SA',
  'Qatar': 'QA',
  'UAE': 'AE',
  'Uzbekistan': 'UZ',
  'Jordan': 'JO',
  'Iraq': 'IQ',
  'New Zealand': 'NZ',
  'Uruguay': 'UY',
  'Colombia': 'CO',
  'Chile': 'CL',
  'Peru': 'PE',
  'Ecuador': 'EC',
  'Paraguay': 'PY',
  'Venezuela': 'VE',
  'Bolivia': 'BO',
  'Costa Rica': 'CR',
  'Panama': 'PA',
  'Honduras': 'HN',
  'Jamaica': 'JM',
  'Haiti': 'HT',
  'Curacao': 'CW', 'Curaçao': 'CW'
};

// Accent/punctuation-insensitive fallback so any spelling variant of a team
// name resolves to its flag (e.g. "Côte d'Ivoire" ↔ "Cote d'Ivoire"). Missing
// or differently-worded names (Cabo/Cape Verde, DR Congo, Curaçao) are covered
// by the explicit keys above; this catches accent/apostrophe/spacing drift.
function _normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’.\-\s]/g, '').toLowerCase();
}
let _normIso = null;
function isoFor(team) {
  if (!team) return '';
  const direct = ISO[team] || ISO[team.trim && team.trim()];
  if (direct) return direct;
  if (!_normIso) {
    _normIso = {};
    for (const k of Object.keys(ISO)) _normIso[_normName(k)] = ISO[k];
  }
  return _normIso[_normName(team)] || '';
}

function isoToEmoji(code) {
  if (!code) return '🏳';
  // Subnational (England, Scotland, Wales) — no clean emoji; return abbreviated text in a span
  if (code.startsWith('GB-')) {
    return code === 'GB-ENG' ? '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'
      : code === 'GB-SCT' ? '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'
      : code === 'GB-WLS' ? '🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}'
      : '🇬🇧';
  }
  if (code.length !== 2) return '🏳';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)));
}

export function flagFor(team) {
  // Two layers: SVG flag-icons (preferred, loaded via flag-icons.min.css on
  // <html class="has-flag-svg">) with the emoji codepoint as fallback.
  // Screen readers skip both (aria-hidden); the adjacent team name is what
  // gets read.
  const code = ISO[team] || ISO[team?.trim()] || '';
  const e = isoToEmoji(code);
  const fiClass = code && code.length === 2 ? `fi fi-${code.toLowerCase()}` : '';
  if (fiClass) return `<span class="flag ${fiClass}" aria-hidden="true">${e}</span>`;
  return `<span class="flag" aria-hidden="true">${e}</span>`;
}

export function rawFlagFor(team) {
  return isoToEmoji(ISO[team] || ISO[team?.trim()] || '');
}

export function flagSpan(team) {
  const span = document.createElement('span');
  span.className = 'flag';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = rawFlagFor(team);
  return span;
}
