/* golden-boot-backtest.mjs — R19: validate the Golden Boot model against past
 * tournaments (Euro, Copa América, last 3 World Cups).
 *
 * Reuses the SAME model the app ships (app/lib/golden-boot.js) — no re-port. For
 * each historical tournament it runs goldenBootProjections on the PRE-tournament
 * inputs and scores the prediction against the actual outcome:
 *   • winnerRank / top3 / top5  — did we rank the actual Golden Boot winner high?
 *   • brier / logLoss           — calibration of the per-player boot probabilities
 *   • goalMAE                   — projected vs actual goals for the top contenders
 *
 * The metric engine is verified by `--selftest` (synthetic tournament). Plug in
 * real data to publish accuracy — see the data contract + TODO at the bottom.
 *
 * Usage:
 *   node scripts/golden-boot-backtest.mjs --selftest
 *   node scripts/golden-boot-backtest.mjs --dir historical/   # real backtest
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { goldenBootProjections, mulberry32 } from '../app/lib/golden-boot.js';

// ---- metrics (pure, exported for unit tests) --------------------------------
export function winnerRank(predicted, actualWinner) {
  const i = predicted.findIndex((c) => c.player === actualWinner);
  return i === -1 ? Infinity : i + 1;
}
export function topNHit(predicted, actualWinner, n) {
  return winnerRank(predicted, actualWinner) <= n;
}
export function brier(predicted, actualWinner) {
  if (!predicted.length) return NaN;
  let s = 0;
  for (const c of predicted) {
    const p = (c.bootPct || 0) / 100;
    const y = c.player === actualWinner ? 1 : 0;
    s += (p - y) ** 2;
  }
  return s / predicted.length;
}
export function logLoss(predicted, actualWinner) {
  const eps = 1e-9;
  const w = predicted.find((c) => c.player === actualWinner);
  const p = Math.min(Math.max((w?.bootPct || 0) / 100, eps), 1 - eps);
  return -Math.log(p); // surprise of the actual winner
}
export function goalMAE(predicted, actualGoalsByPlayer, topK = 10) {
  const top = predicted.slice(0, topK).filter((c) => actualGoalsByPlayer[c.player] != null);
  if (!top.length) return NaN;
  return top.reduce((a, c) => a + Math.abs(c.projGoals - actualGoalsByPlayer[c.player]), 0) / top.length;
}

export function backtestTournament(modelData, actuals, opts = {}) {
  const predicted = goldenBootProjections(modelData, { sims: opts.sims ?? 5000, seed: opts.seed ?? 2026 });
  return {
    name: actuals.name,
    contenders: predicted.length,
    winner: actuals.winner,
    winnerRank: winnerRank(predicted, actuals.winner),
    top3: topNHit(predicted, actuals.winner, 3),
    top5: topNHit(predicted, actuals.winner, 5),
    brier: brier(predicted, actuals.winner),
    logLoss: logLoss(predicted, actuals.winner),
    goalMAE: goalMAE(predicted, actuals.goals || {}),
  };
}

function report(rows) {
  console.log(`${'tournament'.padEnd(14)}${'winner'.padEnd(20)}${'rank'.padStart(6)}${'top5'.padStart(7)}${'brier'.padStart(9)}${'logLoss'.padStart(9)}${'goalMAE'.padStart(9)}`);
  for (const r of rows) {
    console.log(`${r.name.padEnd(14)}${String(r.winner).padEnd(20)}${String(r.winnerRank).padStart(6)}${String(r.top5).padStart(7)}${r.brier.toFixed(4).padStart(9)}${r.logLoss.toFixed(3).padStart(9)}${(Number.isNaN(r.goalMAE) ? '—' : r.goalMAE.toFixed(2)).padStart(9)}`);
  }
  const hit5 = rows.filter((r) => r.top5).length;
  console.log(`\nGolden Boot winner in top-5: ${hit5}/${rows.length}`);
}

// ---- self-test (proves the engine runs without external data) ---------------
function selftest() {
  // Build a synthetic tournament: one elite striker on the strongest team should
  // be the model's clear favorite; treat them as the actual winner.
  const teams = {};
  const groups = ['A', 'B', 'C', 'D'];
  const players = [];
  let gi = 0;
  for (let t = 0; t < 8; t++) {
    const name = `T${t}`;
    const grp = groups[gi % groups.length]; gi++;
    teams[name] = { name, group: grp, composite: 60 + t * 4, position_ratings: { def: 70 - t } };
    players.push({ name: `Striker${t}`, team: name, group: grp, position: 'FWD', scoring: 70 + t * 3 });
    players.push({ name: `Mid${t}`, team: name, group: grp, position: 'MID', scoring: 60 });
  }
  const gm = {};
  for (const g of groups) gm[g] = { teams: Object.keys(teams).filter((n) => teams[n].group === g) };
  const data = { players, teams, groupMatchups: gm, xg: {}, scorers: {} };

  // strongest team T7 → Striker7 should be the favorite; pretend they won with 7.
  const actuals = { name: 'synthWC', winner: 'Striker7', goals: { Striker7: 7, Striker6: 5 } };
  const r = backtestTournament(data, actuals, { sims: 4000 });
  report([r]);
  if (r.winnerRank > 3) throw new Error(`expected the elite striker in top-3, got rank ${r.winnerRank}`);
  if (!(r.brier >= 0 && r.brier <= 1)) throw new Error('brier out of range');
  console.log('\n✓ selftest passed — backtest metric engine works.');
}

function runDir(dir) {
  const rows = [];
  for (const t of readdirSync(dir)) {
    const base = join(dir, t);
    const inputs = join(base, 'inputs.json');
    const actualsF = join(base, 'actuals.json');
    if (!existsSync(inputs) || !existsSync(actualsF)) continue;
    rows.push(backtestTournament(JSON.parse(readFileSync(inputs, 'utf8')), JSON.parse(readFileSync(actualsF, 'utf8'))));
  }
  if (!rows.length) { console.log('No tournaments found in', dir, '(see data contract below).'); return; }
  report(rows);
}

// Only run the CLI when executed directly (so tests can import the metrics).
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) selftest();
  else {
    const di = args.indexOf('--dir');
    if (di === -1) { console.error('usage: --selftest | --dir <historical/>'); process.exit(1); }
    runDir(args[di + 1]);
  }
}

// DATA CONTRACT (the remaining real-data work):
//   historical/<tournament>/inputs.json  — the model inputs AS OF that tournament:
//       { players:[{name,team,group,position,scoring}], teams:{name:{group,composite,
//         position_ratings:{def}}}, groupMatchups:{A:{teams:[…]}}, xg:{} }
//   historical/<tournament>/actuals.json  — { name, winner:"<player>", goals:{player:goals} }
//   Tournaments to add: wc2014, wc2018, wc2022, euro2016, euro2020, euro2024,
//   copa2021, copa2024. Sourcing the contemporary player/team ratings + final
//   goals is the same data tax as the DT backtest (public datasets / FBref).
//   If the model ranks the actual winners in top-5 and beats a naive
//   "best-team's-striker" baseline, the weights in GB_CONFIG earn their place.
