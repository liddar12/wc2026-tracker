/* team-names.js — R13: short-display variants for team names that don't fit
   in narrow card layouts (e.g. iPhone 13 large-match-card). The map is
   conservative — only countries with names that have actually been seen to
   truncate in production are shortened. Add entries as future devices /
   surfaces surface clipping. */

const SHORT_NAMES = {
  'South Africa': 'S. Africa',
  'Korea Republic': 'S. Korea',
  'Saudi Arabia': 'Saudi A.',
  'Czech Republic': 'Czechia',
  'United States': 'USA',
  'Cabo Verde': 'Cabo V.',
  'Cape Verde': 'Cape V.',
  "Côte d'Ivoire": 'Ivory Coast',
  'Cote d\'Ivoire': 'Ivory Coast',
  'Bosnia and Herzegovina': 'Bosnia',
  'Trinidad and Tobago': 'T. & T.',
  'New Zealand': 'N. Zealand',
  'Dominican Republic': 'Dom. Rep.',
  'Central African Republic': 'CAR',
  'Burkina Faso': 'B. Faso',
  'Equatorial Guinea': 'E. Guinea',
};

/**
 * Display-name helper. Returns the short variant if the canonical name is
 * longer than `maxLen` characters; otherwise returns the original.
 *
 * The default cutoff (10 chars) matches what comfortably fits in a
 * `.lcard-team-name` cell at iPhone 13 portrait without ellipsis clipping.
 */
export function shortTeamName(name, maxLen = 10) {
  if (!name) return '';
  if (name.length <= maxLen) return name;
  if (SHORT_NAMES[name]) return SHORT_NAMES[name];
  return name;
}

/** For surfaces where even the short name might clip (very narrow chips). */
export function tinyTeamName(name) {
  return shortTeamName(name, 6);
}
