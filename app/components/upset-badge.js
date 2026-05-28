/* upset-badge.js — render colored badges for upset_risk.indicators. */

export function upsetBadges(indicators) {
  const wrap = document.createElement('div');
  wrap.className = 'upset-badges';
  if (!indicators?.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'No upset signals.';
    wrap.appendChild(empty);
    return wrap;
  }
  for (const ind of indicators) {
    const b = document.createElement('span');
    b.className = `upset-badge sev-${ind.severity || 'low'}`;
    b.textContent = ind.label;
    if (ind.detail) b.title = ind.detail;
    wrap.appendChild(b);
  }
  return wrap;
}

export function hasHighSeverity(indicators) {
  return Array.isArray(indicators) && indicators.some(i => i.severity === 'high');
}
