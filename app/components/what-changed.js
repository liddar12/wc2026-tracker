/* what-changed.js — auto-generated daily narrative for matchups view. */

export function whatChangedToday(data) {
  const bullets = [];
  const markets = data.markets || {};
  const movers = markets.biggest_movers || [];

  if (movers.length) {
    const top = movers[0];
    const dir = top.delta_24h_pp >= 0 ? 'up' : 'down';
    bullets.push(
      `${top.team} moved ${dir} ${Math.abs(top.delta_24h_pp).toFixed(1)}pp on the winner market (${top.prob_pct.toFixed(1)}% now).`
    );
    if (movers.length > 1) {
      const names = movers.slice(1, 4).map((m) => m.team).join(', ');
      bullets.push(`Also moving: ${names}.`);
    }
  }

  const prevVersion = localStorage.getItem('wc26.prev_data_version');
  const curVersion = data.meta?.data_version;
  if (curVersion && prevVersion && prevVersion !== curVersion) {
    bullets.push(`Model data refreshed (${formatWhen(curVersion)}).`);
  }
  if (curVersion) {
    try { localStorage.setItem('wc26.prev_data_version', curVersion); } catch { /* */ }
  }

  const lineupNews = findLineupNews(data.lineups);
  if (lineupNews.length) {
    bullets.push(`Lineup updates: ${lineupNews.slice(0, 3).join('; ')}.`);
  }

  if (!bullets.length) {
    bullets.push('No major market or model changes since your last visit.');
  }

  const wrap = document.createElement('div');
  wrap.className = 'what-changed';
  wrap.innerHTML = '<h2 class="what-changed-title">What changed today</h2>';
  const ul = document.createElement('ul');
  ul.className = 'what-changed-list';
  for (const b of bullets) {
    const li = document.createElement('li');
    li.textContent = b;
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function findLineupNews(lineups) {
  if (!lineups || typeof lineups !== 'object') return [];
  const out = [];
  for (const [key, block] of Object.entries(lineups)) {
    if (!block || typeof block !== 'object') continue;
    const note = block.note || block.headline || block.update;
    if (note) out.push(`${key.replace(/__vs__/g, ' vs ')}: ${note}`);
  }
  return out;
}

function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
