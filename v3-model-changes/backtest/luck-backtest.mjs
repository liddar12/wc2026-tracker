// Does a LUCK factor / de-lucked rating improve calibration?
// 1) luck-as-feature: does a team's recent (actual − Elo-expected) points predict
//    its next result?  2) de-luck rating: standard Elo (goal-margin-reactive) vs a
//    no-margin Elo (ignores blowout variance). Held-out test on WC/Euro/Copa finals.
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean).slice(1).map(l=>{
  const p=l.split(','); return {date:p[0],home:p[1],away:p[2],hs:+p[3],as:+p[4],tournament:p[5],
    neutral:p[p.length-1].trim().toUpperCase()==='TRUE'};
}).filter(r=>Number.isFinite(r.hs)&&Number.isFinite(r.as)).sort((a,b)=>a.date<b.date?-1:1);

const TARG=new Set(['FIFA World Cup','UEFA Euro','Copa América']);
const K=t=>t==='FIFA World Cup'?60:['UEFA Euro','Copa América','African Cup of Nations','AFC Asian Cup','Confederations Cup'].includes(t)?50:/qualif/i.test(t)?40:t==='Friendly'?20:30;
const gm=gd=>gd<=1?1:gd===2?1.5:(11+gd)/8;
const We=dr=>1/(1+10**(-dr/400));
const HFA=100, DRAW0=0.25, WIN=10;

// two ratings: standard (margin) + no-margin; trailing luck per team (last WIN matches)
const Rs=new Map(), Rn=new Map(); const hist=new Map();
const gs=t=>Rs.get(t)??1500, gn=t=>Rn.get(t)??1500;
const targets=[];
for(const m of rows){
  const yr=+m.date.slice(0,4);
  const rhS=gs(m.home),raS=gs(m.away), rhN=gn(m.home),raN=gn(m.away);
  const drS=rhS-raS+(m.neutral?0:HFA);
  const expH=We(drS), eptsH=expH*3*(1-DRAW0)+DRAW0, eptsA=(1-expH)*3*(1-DRAW0)+DRAW0;
  const luck=t=>{const h=hist.get(t)||[]; return h.reduce((s,x)=>s+x,0);};
  if(TARG.has(m.tournament)&&yr>=2010&&yr<=2025){
    targets.push({yr,outcome:m.hs>m.as?'H':m.hs<m.as?'A':'D',
      gapS:(rhS-raS)+(m.neutral?0:HFA), gapN:(rhN-raN)+(m.neutral?0:HFA),
      luckDiff:luck(m.home)-luck(m.away)});
  }
  // actual points
  const apH=m.hs>m.as?3:m.hs===m.as?1:0, apA=m.hs>m.as?0:m.hs===m.as?1:3;
  const pushLuck=(t,a,e)=>{const h=hist.get(t)||[]; h.push(a-e); if(h.length>WIN)h.shift(); hist.set(t,h);};
  pushLuck(m.home,apH,eptsH); pushLuck(m.away,apA,eptsA);
  // update Elo (standard with margin)
  const wH=m.hs>m.as?1:m.hs===m.as?0.5:0;
  const dS=K(m.tournament)*gm(Math.abs(m.hs-m.as))*(wH-expH); Rs.set(m.home,rhS+dS);Rs.set(m.away,raS-dS);
  // no-margin Elo
  const drN=rhN-raN+(m.neutral?0:HFA), expHn=We(drN);
  const dN=K(m.tournament)*1*(wH-expHn); Rn.set(m.home,rhN+dN);Rn.set(m.away,raN-dN);
}
const train=targets.filter(t=>t.yr<=2019), test=targets.filter(t=>t.yr>=2021);
const clampD=d=>Math.max(0.05,Math.min(0.40,d));
function probs(gap,{scale,db,ds}){const p=1/(1+Math.exp(-gap/scale)),d=clampD(db-ds*Math.abs(gap));return{H:p*(1-d),D:d,A:(1-p)*(1-d)};}
function ev(set,gapf,p){let b=0,ll=0,acc=0,dn=0,dc=0;for(const m of set){const pr=probs(gapf(m),p);
  const y={H:+(m.outcome==='H'),D:+(m.outcome==='D'),A:+(m.outcome==='A')};
  b+=(pr.H-y.H)**2+(pr.D-y.D)**2+(pr.A-y.A)**2; ll+=-Math.log(Math.max(1e-9,pr[m.outcome]));
  const fav=pr.H>=pr.A?'H':'A'; if(m.outcome!=='D'){dn++;if(fav===m.outcome)dc++;}
  const pred=pr.H>=pr.D&&pr.H>=pr.A?'H':pr.A>=pr.D?'A':'D'; if(pred===m.outcome)acc++;}
  const n=set.length;return{brier:+(b/n).toFixed(4),logloss:+(ll/n).toFixed(4),acc:+(acc/n).toFixed(4),dec:+(dc/dn).toFixed(4)};}
function fit(set,gapf){let best=null;for(let s=90;s<=320;s+=10)for(let db=0.18;db<=0.34;db+=0.01)for(let ds=0;ds<=0.0016;ds+=0.0001){const e=ev(set,gapf,{scale:s,db,ds});if(!best||e.logloss<best.e.logloss)best={p:{scale:s,db:+db.toFixed(2),ds:+ds.toFixed(4)},e};}return best;}

console.log(`targets ${targets.length} (train ${train.length}/test ${test.length})`);
// M0 baseline (standard Elo)
const m0=fit(train,t=>t.gapS); console.log('\nM0 Elo baseline      TEST', ev(test,t=>t.gapS,m0.p));
// M2 de-luck (no-margin Elo)
const m2=fit(train,t=>t.gapN); console.log('M2 de-luck (no-margin) TEST', ev(test,t=>t.gapN,m2.p));
// M1 +luck feature: sweep gamma (Elo pts per luck-point) on top of baseline scale
let bestG=null;
for(let g=-40;g<=40;g+=2){const f=t=>t.gapS+g*t.luckDiff; const fit1=fit(train,f); const e=ev(test,f,fit1.p);
  const tr=ev(train,f,fit1.p); if(!bestG||tr.logloss<bestG.tr)bestG={g,e,tr:tr.logloss,p:fit1.p};}
console.log(`M1 +luck (best γ=${bestG.g} Elo/luck-pt) TEST`, bestG.e);
const lk=test.map(t=>t.luckDiff);
console.log(`\nluckDiff spread: mean ${(lk.reduce((s,x)=>s+x,0)/lk.length).toFixed(2)}, sd ${Math.sqrt(lk.reduce((s,x)=>s+x*x,0)/lk.length).toFixed(2)}`);
