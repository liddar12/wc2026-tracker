// Backtest the V3 (uploaded) bivariate-Poisson match model — its outcome_probs —
// driven by the SAME point-in-time Elo, vs the logistic. Tests whether the V3
// scoreline FORM improves calibration over the simple logistic, single-signal.
import { runElo } from './elo-engine.mjs';
const CSV = process.argv[2];
const { targets } = runElo(CSV, new Set(['FIFA World Cup','UEFA Euro','Copa América']));
const gapOf = (m)=> (m.eloH - m.eloA) + (m.neutral?0:100);

// --- V3 match model (ported from match_model.py outcome_probs, independent grid)
function lgamma(x){ // Lanczos
  const g=7, c=[0.99999999999980993,676.5203681218851,-1259.1392167224028,
    771.32342877765313,-176.61502916214059,12.507343278686905,
    -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if(x<0.5) return Math.log(Math.PI/Math.sin(Math.PI*x))-lgamma(1-x);
  x-=1; let a=c[0]; const t=x+g+0.5;
  for(let i=1;i<g+2;i++) a+=c[i]/(x+i);
  return 0.5*Math.log(2*Math.PI)+(x+0.5)*Math.log(t)-t+Math.log(a);
}
const MAXG=12;
function pois(k,lam){ return Math.exp(k*Math.log(lam)-lam-lgamma(k+1)); }
function v3probs(gap,{mu,beta}){
  const sup=beta*gap;
  const lamH=Math.exp(mu+sup/2), lamA=Math.exp(mu-sup/2);
  const pa=[],pb=[]; for(let k=0;k<=MAXG;k++){pa.push(pois(k,lamH));pb.push(pois(k,lamA));}
  let H=0,D=0,A=0;
  for(let i=0;i<=MAXG;i++)for(let j=0;j<=MAXG;j++){const p=pa[i]*pb[j]; if(i>j)H+=p; else if(i===j)D+=p; else A+=p;}
  const t=H+D+A; return {H:H/t,D:D/t,A:A/t};
}
function evalSet(set,params){
  let brier=0,ll=0,correct=0;
  for(const m of set){
    const p=v3probs(gapOf(m),params);
    const y={H:m.outcome==='H'?1:0,D:m.outcome==='D'?1:0,A:m.outcome==='A'?1:0};
    brier+=(p.H-y.H)**2+(p.D-y.D)**2+(p.A-y.A)**2;
    ll+=-Math.log(Math.max(1e-9,p[m.outcome]));
    const pred=p.H>=p.D&&p.H>=p.A?'H':p.A>=p.D?'A':'D';
    if(pred===m.outcome)correct++;
  }
  const n=set.length; return {n,brier:+(brier/n).toFixed(4),logloss:+(ll/n).toFixed(4),acc:+(correct/n).toFixed(4)};
}
function fit(set){
  let best=null;
  for(let mu=0.0;mu<=0.55;mu+=0.05)
    for(let beta=0.0005;beta<=0.0045;beta+=0.0001){
      const e=evalSet(set,{mu,beta});
      if(!best||e.logloss<best.e.logloss)best={params:{mu:+mu.toFixed(2),beta:+beta.toFixed(4)},e};
    }
  return best;
}
const train=targets.filter(m=>m.yr<=2019), test=targets.filter(m=>m.yr>=2021);
console.log(`V3 bivariate-Poisson match model (Elo-driven), ${targets.length} matches`);
// V3 default-ish (beta on raw elo gap tuned to ~goal scale)
const f=fit(train);
console.log('\nTUNED on train (≤2019) → held-out test (≥2021)');
console.log('  best params:',f.params);
console.log('  train:',f.e);
console.log('  TEST :',evalSet(test,f.params));
const fAll=fit(targets);
console.log('\nTUNED full sample:',fAll.params,'→',evalSet(targets,fAll.params));
