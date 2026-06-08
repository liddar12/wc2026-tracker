// W/D/L backtest harness: Elo-only baseline + logistic-parameter tuning.
// Metrics: multiclass Brier, log-loss, 1X2 accuracy. Temporal train/test split.
import { runElo } from './elo-engine.mjs';

const CSV = process.argv[2];
const TARGETS = new Set(['FIFA World Cup','UEFA Euro','Copa América']);
const { targets } = runElo(CSV, TARGETS);

// 3-way prob model from an Elo gap (home perspective; gap already includes home adv).
function probs(gap, {scale, drawBase, drawSlope}) {
  const pH2 = 1/(1+Math.exp(-gap/scale));
  let draw = drawBase - drawSlope*Math.abs(gap);
  draw = Math.max(0.05, Math.min(0.40, draw));
  return { H: pH2*(1-draw), D: draw, A: (1-pH2)*(1-draw) };
}
const gapOf = (m)=> (m.eloH - m.eloA) + (m.neutral?0:100);

function evalSet(set, params) {
  let brier=0, ll=0, correct=0;
  for (const m of set) {
    const p = probs(gapOf(m), params);
    const y = {H:m.outcome==='H'?1:0, D:m.outcome==='D'?1:0, A:m.outcome==='A'?1:0};
    brier += (p.H-y.H)**2 + (p.D-y.D)**2 + (p.A-y.A)**2;
    ll += -Math.log(Math.max(1e-9, p[m.outcome]));
    const pred = p.H>=p.D && p.H>=p.A ? 'H' : p.A>=p.D ? 'A' : 'D';
    if (pred===m.outcome) correct++;
  }
  const n=set.length;
  return { n, brier:brier/n, logloss:ll/n, acc:correct/n };
}

// canonical-Elo baseline: scale = 400/ln(10) ≈ 173.7 (pure Elo win expectancy),
// with a plain draw model (typical intl draw rate ~0.23 at gap 0).
const BASELINE = { scale: 173.7, drawBase: 0.26, drawSlope: 0.0004 };

// grid search to minimize log-loss
function fit(trainSet) {
  let best=null;
  for (let scale=90; scale<=320; scale+=10)
    for (let drawBase=0.18; drawBase<=0.34; drawBase+=0.01)
      for (let drawSlope=0; drawSlope<=0.0016; drawSlope+=0.0001) {
        const e = evalSet(trainSet, {scale,drawBase,drawSlope});
        if (!best || e.logloss<best.e.logloss) best={params:{scale,drawBase,drawSlope},e};
      }
  return best;
}

const train = targets.filter(m=>m.yr<=2019);
const test  = targets.filter(m=>m.yr>=2021);

console.log(`Target matches: ${targets.length}  (train ≤2019: ${train.length}, test ≥2021: ${test.length})`);
console.log('\n— BASELINE (canonical Elo, untuned) —');
console.log('  full:', evalSet(targets, BASELINE));
console.log('  test:', evalSet(test, BASELINE));

const f = fit(train);
console.log('\n— TUNED on train (≤2019), evaluated on held-out test (≥2021) —');
console.log('  best params:', f.params);
console.log('  train:', f.e);
console.log('  TEST :', evalSet(test, f.params));

const fAll = fit(targets);
console.log('\n— TUNED on full sample (in-sample fit) —');
console.log('  best params:', fAll.params);
console.log('  full:', evalSet(targets, fAll.params));

// draw-rate sanity
const drawRate = targets.filter(m=>m.outcome==='D').length/targets.length;
console.log(`\nActual draw rate in target matches: ${(drawRate*100).toFixed(1)}%`);
