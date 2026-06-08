import csv, sys, math
rows=list(csv.DictReader(open(sys.argv[1])))
def num(x):
    try: return float(x)
    except: return None
for r in rows: r['_d']=r['date']
rows=[r for r in rows if num(r['home_team_score']) is not None and num(r['away_team_score']) is not None]
rows.sort(key=lambda r:r['date'])
# --- Elo forward ---
def K(t):
    if t=='FIFA World Cup': return 60
    if t in ('UEFA Euro','Copa América','African Cup of Nations','AFC Asian Cup','Confederations Cup'): return 50
    if 'qualif' in t.lower(): return 40
    if t=='Friendly': return 20
    return 30
def gm(gd): return 1 if gd<=1 else 1.5 if gd==2 else (11+gd)/8
R={}
def get(t): return R.get(t,1500.0)
for m in rows:
    h,a=m['home_team'],m['away_team']; rh,ra=get(h),get(a)
    m['eloH'],m['eloA']=rh,ra
    neutral=str(m['neutral_location']).upper()=='TRUE'
    hs,as_=num(m['home_team_score']),num(m['away_team_score'])
    dr=rh-ra+(0 if neutral else 100); We=1/(1+10**(-dr/400))
    w=1.0 if hs>as_ else 0.5 if hs==as_ else 0.0
    d=K(m['tournament'])*gm(abs(hs-as_))*(w-We); R[h]=rh+d; R[a]=ra-d
# --- target set with talent ---
targ={'FIFA World Cup','UEFA Euro','Copa América','Copa America'}
def talent(m):
    H=[num(m['home_team_mean_offense_score']),num(m['home_team_mean_defense_score']),num(m['home_team_mean_midfield_score']),num(m['home_team_goalkeeper_score'])]
    A=[num(m['away_team_mean_offense_score']),num(m['away_team_mean_defense_score']),num(m['away_team_mean_midfield_score']),num(m['away_team_goalkeeper_score'])]
    if any(x is None for x in H+A): return None
    return sum(H),sum(A)
T=[]
for m in rows:
    y=int(m['date'][:4])
    if m['tournament'] not in targ or y<2010 or y>2021: continue
    tl=talent(m)
    if tl is None: continue
    hs,as_=num(m['home_team_score']),num(m['away_team_score'])
    neutral=str(m['neutral_location']).upper()=='TRUE'
    T.append(dict(yr=y, eloGap=(m['eloH']-m['eloA'])+(0 if neutral else 100),
                  talGap=tl[0]-tl[1], outcome='H' if hs>as_ else 'A' if hs<as_ else 'D'))
train=[m for m in T if m['yr']<=2018]; test=[m for m in T if m['yr']>=2019]
def mean(a): return sum(a)/len(a)
def std(a,m): return math.sqrt(sum((x-m)**2 for x in a)/len(a))
eM=mean([m['eloGap'] for m in train]); eS=std([m['eloGap'] for m in train],eM)
tM=mean([m['talGap'] for m in train]); tS=std([m['talGap'] for m in train],tM)
zE=lambda g:(g-eM)/eS; zT=lambda g:(g-tM)/tS
def clamp(d): return max(0.05,min(0.40,d))
def probs(m,w,scale,db,ds):
    c=w*zE(m['eloGap'])+(1-w)*zT(m['talGap'])
    pH2=1/(1+math.exp(-c/scale)); d=clamp(db-ds*abs(c))
    return {'H':pH2*(1-d),'D':d,'A':(1-pH2)*(1-d)}
def ev(set_,w,scale,db,ds):
    three=brier=ll=decN=decC=0
    for m in set_:
        pr=probs(m,w,scale,db,ds)
        pred=max(pr,key=pr.get)
        if pred==m['outcome']: three+=1
        for k in 'HDA':
            y=1 if m['outcome']==k else 0; brier+=(pr[k]-y)**2
        ll+=-math.log(max(1e-9,pr[m['outcome']]))
        fav='H' if pr['H']>=pr['A'] else 'A'
        if m['outcome']!='D':
            decN+=1
            if fav==m['outcome']: decC+=1
    n=len(set_); return dict(acc=three/n,brier=brier/n,ll=ll/n,dec=decC/decN if decN else 0)
def fit(set_,w):
    best=None
    s=0.4
    while s<=2.5:
        db=0.18
        while db<=0.34:
            ds=0.0
            while ds<=0.10:
                e=ev(set_,w,s,db,ds)
                if best is None or e['ll']<best[1]['ll']: best=((round(s,2),round(db,2),round(ds,2)),e)
                ds+=0.01
            db+=0.01
        s+=0.05
    return best
print(f"Independent-signal blend: Elo + FIFA squad-talent")
print(f"Target matches 2010-2021 w/ talent: {len(T)} (train<=2018 {len(train)} / test>=2019 {len(test)})")
print(f"Test draw rate: {sum(1 for m in test if m['outcome']=='D')/len(test)*100:.0f}%\n")
print("w(Elo) | TEST 3way  decisive  brier   logloss")
out=[]
for i in range(11):
    w=i/10; p,_=fit(train,w); e=ev(test,w,*p); out.append((w,e))
    print(f"{w:.1f}    |  {e['acc']*100:.1f}%    {e['dec']*100:.1f}%   {e['brier']:.4f}  {e['ll']:.4f}")
elo=[e for w,e in out if w==1.0][0]
bLL=min(out,key=lambda o:o[1]['ll']); bDec=max(out,key=lambda o:o[1]['dec'])
print(f"\nElo-only (w=1.0):  logloss {elo['ll']:.4f}  decisive {elo['dec']*100:.1f}%  brier {elo['brier']:.4f}")
print(f"Best calibration:  w={bLL[0]:.1f}  logloss {bLL[1]['ll']:.4f}  decisive {bLL[1]['dec']*100:.1f}%")
print(f"Best decisive:     w={bDec[0]:.1f}  decisive {bDec[1]['dec']*100:.1f}%  logloss {bDec[1]['ll']:.4f}")
imp=(elo['ll']-bLL[1]['ll'])/elo['ll']*100
print(f"\nVERDICT: independent talent signal {'IMPROVES' if imp>0.3 else 'does NOT meaningfully improve'} calibration "
      f"({imp:+.1f}% log-loss vs Elo-only); best decisive {bDec[1]['dec']*100:.1f}% vs Elo-only {elo['dec']*100:.1f}%.")
