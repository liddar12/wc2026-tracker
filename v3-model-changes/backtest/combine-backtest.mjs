// Combine J5L + DT + V3 match models and backtest every weight combination.
//
// Each model is a P(H/D/A) function of the point-in-time Elo gap (the only
// signal reconstructable 15y back — so historically the three models share a
// signal; see the diversification note the script prints). The three FORMS:
//   J5L  = tuned logistic              p = 1/(1+e^(-gap/scale))
//   V3   = bivariate-Poisson           outcome_probs(exp(mu±beta*gap/2))
//   DT   = canonical Elo expectancy    p = 1/(1+10^(-gap/400))   (DT is pure Elo today)
// An ensemble is a weighted average of the three probability vectors.
//
// Reports, on a held-out test split (>=2021), for every combo:
//   acc1x2  — raw win/draw/loss accuracy  (ceiling ~56%, NOT 80% for anyone)
//   brier, logloss — calibration (lower better)
//   decAcc  — favourite correct among non-draw (decisive) matches
//   conf@t / cov@t — among matches where the favourite prob >= t, how often the
//                    favourite AVOIDS DEFEAT (win or draw), and what % of matches
//                    qualify. This is where good models exceed 80%.
import { runElo } from './elo-engine.mjs';
import { writeFileSync } from 'node:fs';

const CSV = process.argv[2];
const { targets } = runElo(CSV, new Set(['FIFA World Cup','UEFA Euro','Copa América']));
const train = targets.filter(m=>m.yr<=2019), test = targets.filter(m=>m.yr>=2021);
const gapOf = (m)=> (m.eloH - m.eloA) + (m.neutral?0:100);

// ---- model forms -----------------------------------------------------------
function clampDraw(d){ return Math.max(0.05, Math.min(0.40, d)); }
function probLogistic(gap,{scale,drawBase,drawSlope}){
  const pH2=1/(1+Math.exp(-gap/scale)); const d=clampDraw(drawBase-drawSlope*Math.abs(gap));
  return {H:pH2*(1-d),D:d,A:(1-pH2)*(1-d)};
}
function probElo(gap,{drawBase,drawSlope}){
  const pH2=1/(1+10**(-gap/400)); const d=clampDraw(drawBase-drawSlope*Math.abs(gap));
  return {H:pH2*(1-d),D:d,A:(1-pH2)*(1-d)};
}
function lgamma(x){const g=7,c=[0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];if(x<0.5)return Math.log(Math.PI/Math.sin(Math.PI*x))-lgamma(1-x);x-=1;let a=c[0];const t=x+g+0.5;for(let i=1;i<g+2;i++)a+=c[i]/(x+i);return 0.5*Math.log(2*Math.PI)+(x+0.5)*Math.log(t)-t+Math.log(a);}
const MAXG=12; const pois=(k,l)=>Math.exp(k*Math.log(l)-l-lgamma(k+1));
function probPoisson(gap,{mu,beta}){
  const s=beta*gap, lH=Math.exp(mu+s/2), lA=Math.exp(mu-s/2);
  const pa=[],pb=[]; for(let k=0;k<=MAXG;k++){pa.push(pois(k,lH));pb.push(pois(k,lA));}
  let H=0,D=0,A=0; for(let i=0;i<=MAXG;i++)for(let j=0;j<=MAXG;j++){const p=pa[i]*pb[j]; if(i>j)H+=p;else if(i===j)D+=p;else A+=p;}
  const t=H+D+A; return {H:H/t,D:D/t,A:A/t};
}

// ---- fit each base model on train (min log-loss) ---------------------------
const ll=(set,fn)=>{let s=0;for(const m of set)s+=-Math.log(Math.max(1e-9,fn(m)[m.outcome]));return s/set.length;};
function fitLogistic(set){let best=null;for(let scale=90;scale<=320;scale+=10)for(let db=0.18;db<=0.34;db+=0.01)for(let ds=0;ds<=0.0016;ds+=0.0001){const v=ll(set,m=>probLogistic(gapOf(m),{scale,drawBase:db,drawSlope:ds}));if(!best||v<best.v)best={p:{scale,drawBase:+db.toFixed(2),drawSlope:+ds.toFixed(4)},v};}return best.p;}
function fitElo(set){let best=null;for(let db=0.18;db<=0.34;db+=0.01)for(let ds=0;ds<=0.0016;ds+=0.0001){const v=ll(set,m=>probElo(gapOf(m),{drawBase:db,drawSlope:ds}));if(!best||v<best.v)best={p:{drawBase:+db.toFixed(2),drawSlope:+ds.toFixed(4)},v};}return best.p;}
function fitPoisson(set){let best=null;for(let mu=0;mu<=0.55;mu+=0.05)for(let beta=0.0005;beta<=0.0045;beta+=0.0001){const v=ll(set,m=>probPoisson(gapOf(m),{mu,beta}));if(!best||v<best.v)best={p:{mu:+mu.toFixed(2),beta:+beta.toFixed(4)},v};}return best.p;}

const pJ=fitLogistic(train), pD=fitElo(train), pV=fitPoisson(train);
const base = {
  J5L:(m)=>probLogistic(gapOf(m),pJ),
  DT :(m)=>probElo(gapOf(m),pD),
  V3 :(m)=>probPoisson(gapOf(m),pV),
};
// precompute prob vectors per match per model
const vec = new Map();
for (const m of targets) vec.set(m, {J5L:base.J5L(m), DT:base.DT(m), V3:base.V3(m)});

// ---- metrics ---------------------------------------------------------------
function metrics(set, weights){ // weights {J5L,DT,V3} summing to 1
  let brier=0, llSum=0, acc=0, decN=0, decC=0;
  const thr=[0.50,0.60,0.65,0.70]; const conf={}, cov={};
  thr.forEach(t=>{conf[t]=0;cov[t]=0;});
  for (const m of set){
    const v=vec.get(m);
    const p={H:0,D:0,A:0};
    for (const k of ['J5L','DT','V3']){ p.H+=weights[k]*v[k].H; p.D+=weights[k]*v[k].D; p.A+=weights[k]*v[k].A; }
    const y={H:m.outcome==='H'?1:0,D:m.outcome==='D'?1:0,A:m.outcome==='A'?1:0};
    brier+=(p.H-y.H)**2+(p.D-y.D)**2+(p.A-y.A)**2;
    llSum+=-Math.log(Math.max(1e-9,p[m.outcome]));
    const pred=p.H>=p.D&&p.H>=p.A?'H':p.A>=p.D?'A':'D'; if(pred===m.outcome)acc++;
    // decisive (non-draw): favourite among H/A correct?
    const fav=p.H>=p.A?'H':'A';
    if(m.outcome!=='D'){decN++; if(fav===m.outcome)decC++;}
    // confidence buckets: favourite prob, "no loss" = fav wins or draw
    const favP=Math.max(p.H,p.A); const noLoss=(m.outcome===fav||m.outcome==='D');
    thr.forEach(t=>{ if(favP>=t){cov[t]++; if(noLoss)conf[t]++;} });
  }
  const n=set.length;
  const out={n,acc1x2:+(acc/n).toFixed(4),brier:+(brier/n).toFixed(4),logloss:+(llSum/n).toFixed(4),
             decAcc:+(decC/Math.max(1,decN)).toFixed(4)};
  thr.forEach(t=>{ out[`conf@${t}`]= cov[t]? +(conf[t]/cov[t]).toFixed(4):null; out[`cov@${t}`]=+(cov[t]/n).toFixed(3); });
  return out;
}

// ---- enumerate weight combinations (simplex, step 0.1) ---------------------
const combos=[];
for(let a=0;a<=10;a++)for(let b=0;b<=10-a;b++){const c=10-a-b;
  combos.push({J5L:a/10,DT:b/10,V3:c/10});}

console.log('=== Base model params (fitted on train ≤2019) ===');
console.log('  J5L(logistic):',pJ,'\n  DT(Elo-expect):',pD,'\n  V3(Poisson):',pV);
console.log(`\nMatches: train ${train.length} / test ${test.length}. Draw rate ${(targets.filter(m=>m.outcome==='D').length/targets.length*100).toFixed(1)}%.`);

// evaluate all combos on TEST (weights fit-free: averaging is not overfit-prone)
const rows = combos.map(w=>({w, ...metrics(test,w)}));

// rank by log-loss (calibration) for the headline
const byLL=[...rows].sort((x,y)=>x.logloss-y.logloss);
const fmtW=w=>`J5L${w.J5L.toFixed(1)}/DT${w.DT.toFixed(1)}/V3${w.V3.toFixed(1)}`;

console.log('\n=== Best 8 combinations by calibration (log-loss), held-out TEST ===');
console.log('combo                  acc1X2  brier  logloss  decAcc  conf@.65 cov@.65');
for(const r of byLL.slice(0,8))
  console.log(`${fmtW(r.w).padEnd(22)} ${(r.acc1x2*100).toFixed(1)}%  ${r.brier}  ${r.logloss}  ${(r.decAcc*100).toFixed(1)}%  ${(r['conf@0.65']*100).toFixed(1)}%   ${(r['cov@0.65']*100).toFixed(0)}%`);

console.log('\n=== The three single models (corners) ===');
for(const w of [{J5L:1,DT:0,V3:0},{J5L:0,DT:1,V3:0},{J5L:0,DT:0,V3:1}]){
  const r=metrics(test,w);
  console.log(`${fmtW(w).padEnd(22)} acc ${(r.acc1x2*100).toFixed(1)}%  brier ${r.brier}  logloss ${r.logloss}  decAcc ${(r.decAcc*100).toFixed(1)}%`);
}

// combos that exceed 80% on the confident-favourite metric (with coverage)
console.log('\n=== Combinations ABOVE 80% (favourite avoids defeat) by confidence threshold ===');
for(const t of [0.60,0.65,0.70]){
  const pass=rows.filter(r=>r[`conf@${t}`]!=null && r[`conf@${t}`]>=0.80);
  const covAvg = pass.length? (pass.reduce((s,r)=>s+r[`cov@${t}`],0)/pass.length*100).toFixed(0):'-';
  console.log(`  threshold ≥${t}: ${pass.length}/${rows.length} combos clear 80%  (avg coverage ${covAvg}% of matches)`);
}
// show a representative passing combo at 0.65
const ex=byLL.find(r=>r['conf@0.65']>=0.80);
if(ex) console.log(`  e.g. ${fmtW(ex.w)} → conf@.65 ${(ex['conf@0.65']*100).toFixed(1)}% over ${(ex['cov@0.65']*100).toFixed(0)}% of matches`);

// write full table CSV
const cols=['J5L','DT','V3','n','acc1x2','brier','logloss','decAcc','conf@0.5','cov@0.5','conf@0.6','cov@0.6','conf@0.65','cov@0.65','conf@0.7','cov@0.7'];
let csv=cols.join(',')+'\n';
for(const r of byLL) csv+=[r.w.J5L,r.w.DT,r.w.V3,r.n,r.acc1x2,r.brier,r.logloss,r.decAcc,r['conf@0.5'],r['cov@0.5'],r['conf@0.6'],r['cov@0.6'],r['conf@0.65'],r['cov@0.65'],r['conf@0.7'],r['cov@0.7']].join(',')+'\n';
writeFileSync(process.argv[3]||'/tmp/combine-results.csv', csv);
console.log(`\nFull ${rows.length}-combo table written to ${process.argv[3]||'/tmp/combine-results.csv'}`);
