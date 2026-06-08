// Canonical World-Football-Elo engine + target-match extractor.
// Runs forward over the full international results history (martj42 dataset)
// to produce point-in-time pre-match Elo for every team — no scraping.
import { readFileSync } from 'node:fs';

const HOME_ADV = 100;            // eloratings.net home advantage
const K_BY_TOURN = (t) => {
  if (t === 'FIFA World Cup') return 60;
  if (['UEFA Euro','Copa América','African Cup of Nations','AFC Asian Cup','Gold Cup','Confederations Cup'].includes(t)) return 50;
  if (/qualification|qualifier/i.test(t)) return 40;
  if (t === 'UEFA Nations League') return 45;
  if (t === 'Friendly') return 20;
  return 30;                     // other competitive
};
const goalMult = (gd) => gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;

function parseCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    // naive split is fine: no quoted commas in this dataset's numeric/date cols,
    // but city/country can contain commas — handle via split-limit on known shape.
    const p = l.split(',');
    // columns: date,home,away,hs,as,tournament,city,country,neutral  (9)
    // team/tournament names have no commas in this dataset.
    return { date:p[0], home:p[1], away:p[2], hs:+p[3], as:+p[4], tournament:p[5],
             neutral: p[p.length-1].trim().toUpperCase()==='TRUE' };
  }).filter(r => Number.isFinite(r.hs) && Number.isFinite(r.as));
}

export function runElo(csvPath, targetSet) {
  const rows = parseCsv(csvPath).sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const R = new Map();
  const get = (t)=> R.get(t) ?? 1500;
  const targets = [];
  for (const m of rows) {
    const yr = +m.date.slice(0,4);
    const rh = get(m.home), ra = get(m.away);
    const isTarget = targetSet.has(m.tournament) && yr>=2010 && yr<=2025;
    if (isTarget) {
      const outcome = m.hs>m.as ? 'H' : m.hs<m.as ? 'A' : 'D';
      targets.push({ date:m.date, yr, tournament:m.tournament, home:m.home, away:m.away,
                     eloH:rh, eloA:ra, neutral:m.neutral, outcome });
    }
    // update Elo (over ALL matches, target or not)
    const dr = rh - ra + (m.neutral ? 0 : HOME_ADV);
    const We = 1/(1+10**(-dr/400));
    const Wh = m.hs>m.as?1:m.hs<m.as?0.5+0:m.hs===m.as?0.5:0; // win1 draw.5 loss0
    const wHome = m.hs>m.as?1:m.hs===m.as?0.5:0;
    const K = K_BY_TOURN(m.tournament) * goalMult(Math.abs(m.hs-m.as));
    const delta = K*(wHome - We);
    R.set(m.home, rh+delta); R.set(m.away, ra-delta);
  }
  return { targets, finalRatings:R };
}
