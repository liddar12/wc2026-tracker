#!/usr/bin/env python3
"""Luck analysis for WC2026 — remaining teams (France, Spain, England, Argentina).

Metrics ("luck" = things outside sustained skill):
  pens_for / pens_against    scored penalty kicks awarded for/against (pen-goal events)
  corners_for / corners_against  wonCorners from match_stats
  foul_diff                  fouls drawn - fouls committed (favorable-whistle proxy)
  cards_for / cards_against  yellows+2*reds received vs opponents' received
  own_goal_gifts             opponent own-goals credited to the team
  finish_luck                goals scored - pre-match model xG (overperformance)
  concede_luck               opp xG - goals conceded (defensive overperformance)
  shootout_wins              penalty-shootout wins (coin-flip component)

Luck index = mean of z-scored components (signed so + = lucky).
Backtest: group-stage luck only -> predict the 28 played knockout matches
(R32 16, R16 8, QF 4) with stack strengths +/- lambda * luck. 2-way log-loss.
"""
import json, math, statistics as st
from collections import defaultdict

D = lambda p: json.load(open(f'data/{p}'))
sched = D('schedule_full.json')
matches = sched['matches'] if isinstance(sched, dict) and 'matches' in sched else sched
stage_of = {}
for m in matches:
    stage_of[f"{m['team_a']}__vs__{m['team_b']}"] = m.get('stage')

stats = D('match_stats.json'); events = D('match_events.json'); xg = D('xg.json')
ar = D('actual_results.json'); stk = D('stacker.json')['strengths']

KO_STAGES = ('round_of_32','round_of_16','quarterfinals','semifinals','third_place','final')

def stage_for_key(k):
    if '__vs__' not in k: return None
    if k in stage_of: return stage_of[k]
    a, b = k.split('__vs__')
    return stage_of.get(f'{b}__vs__{a}')

# ---- per-team group-stage tallies -------------------------------------------
T = defaultdict(lambda: defaultdict(float))
gp = defaultdict(int)  # group-stage matches with stats

for k, rec in stats.items():
    stg = stage_for_key(k)
    if stg != 'group': continue
    a, b = rec['team_a'], rec['team_b']
    sa, sb = rec['stats'].get('a', {}), rec['stats'].get('b', {})
    if not sa or not sb: continue
    gp[a] += 1; gp[b] += 1
    T[a]['corners_for'] += sa.get('wonCorners', 0) or 0
    T[a]['corners_against'] += sb.get('wonCorners', 0) or 0
    T[b]['corners_for'] += sb.get('wonCorners', 0) or 0
    T[b]['corners_against'] += sa.get('wonCorners', 0) or 0
    T[a]['fouls_committed'] += sa.get('foulsCommitted', 0) or 0
    T[a]['fouls_drawn'] += sb.get('foulsCommitted', 0) or 0
    T[b]['fouls_committed'] += sb.get('foulsCommitted', 0) or 0
    T[b]['fouls_drawn'] += sa.get('foulsCommitted', 0) or 0

for k, rec in events.items():
    stg = stage_for_key(k)
    if stg != 'group': continue
    a, b = k.split('__vs__')
    for e in rec.get('events', []):
        t, team = e.get('type'), e.get('team')
        if team not in (a, b): continue
        other = b if team == a else a
        if t == 'pen-goal':
            T[team]['pens_for'] += 1; T[other]['pens_against'] += 1
        elif t == 'yellow':
            T[team]['cards'] += 1; T[other]['opp_cards'] += 1
        elif t == 'red':
            T[team]['cards'] += 2; T[other]['opp_cards'] += 2
        elif t == 'own-goal':
            # own-goal by `team` gifts a goal to the other side
            T[other]['own_goal_gifts'] += 1

# goals vs pre-match xg (group stage)
gs = ar.get('group_stage', {})
for k, rec in gs.items():
    if rec.get('status') == 'STATUS_SCHEDULED': continue
    a, b = k.split('__vs__')
    x = xg.get(k) or xg.get(f'{b}__vs__{a}')
    sa, sb = rec.get('score_a'), rec.get('score_b')
    if not isinstance(sa, (int, float)) or not isinstance(sb, (int, float)): continue
    T[a]['gs_played'] += 1; T[b]['gs_played'] += 1
    if x and x.get('team_a') == a:
        T[a]['finish_luck'] += sa - x['team_a_xg']; T[b]['finish_luck'] += sb - x['team_b_xg']
        T[a]['concede_luck'] += x['team_b_xg'] - sb; T[b]['concede_luck'] += x['team_a_xg'] - sa

# shootout wins (whole tournament, luck by definition)
shootouts = defaultdict(int)
for stg in KO_STAGES:
    for k, rec in ar.get(stg, {}).items():
        if rec.get('method') == 'pens' and rec.get('winner'):
            shootouts[rec['winner']] += 1

# ---- per-match rates + luck index -------------------------------------------
teams = [t for t in gp if gp[t] >= 2]
def rate(t, k): return T[t][k] / max(gp[t], 1)

COMP = {  # sign: + = lucky
    'pens_for': +1, 'pens_against': -1,
    'corners_for': +1, 'corners_against': -1,
    'foul_diff': +1,          # fouls drawn - committed
    'card_diff': +1,          # opp cards - own cards
    'own_goal_gifts': +1,
    'finish_luck': +1, 'concede_luck': +1,
}
rows = {}
for t in teams:
    rows[t] = {
        'pens_for': rate(t, 'pens_for'), 'pens_against': rate(t, 'pens_against'),
        'corners_for': rate(t, 'corners_for'), 'corners_against': rate(t, 'corners_against'),
        'foul_diff': rate(t, 'fouls_drawn') - rate(t, 'fouls_committed'),
        'card_diff': rate(t, 'opp_cards') - rate(t, 'cards'),
        'own_goal_gifts': rate(t, 'own_goal_gifts'),
        'finish_luck': T[t]['finish_luck'] / max(T[t]['gs_played'], 1),
        'concede_luck': T[t]['concede_luck'] / max(T[t]['gs_played'], 1),
    }

def zmap(key):
    vals = [rows[t][key] for t in teams]
    mu, sd = st.mean(vals), st.pstdev(vals) or 1
    return {t: (rows[t][key] - mu) / sd for t in teams}

Z = {k: zmap(k) for k in COMP}
luck = {t: st.mean([COMP[k] * Z[k][t] for k in COMP]) for t in teams}

# "calls-only" narrow index per the user's definition (pens, corners, fouls, cards)
CALLS = ['pens_for','pens_against','corners_for','corners_against','foul_diff','card_diff']
luck_calls = {t: st.mean([COMP[k] * Z[k][t] for k in CALLS]) for t in teams}

REMAIN = ['France','Spain','England','Argentina']
print('=== LUCK PROFILE (group-stage per-match rates; 48-team z in parens) ===')
hdr = ['team'] + list(COMP) + ['LUCK', 'CALLS-LUCK', 'SO_wins', 'rank/48']
ranked = sorted(teams, key=lambda t: -luck[t])
for t in REMAIN:
    r = rows[t]
    cells = [f"{r[k]:+.2f}({Z[k][t]:+.1f}z)" for k in COMP]
    print(f"{t:10s} " + ' '.join(f'{k}={c}' for k, c in zip(COMP, cells)))
    print(f"           LUCK={luck[t]:+.2f}  CALLS-ONLY={luck_calls[t]:+.2f}  shootout_wins={shootouts[t]}  rank={ranked.index(t)+1}/48")

print()
print('luckiest 5 :', [(t, round(luck[t], 2)) for t in ranked[:5]])
print('unluckiest5:', [(t, round(luck[t], 2)) for t in ranked[-5:]])

# confounding: correlation luck vs stack strength
common = [t for t in teams if t in stk]
mx = st.mean([stk[t] for t in common]); sx = st.pstdev([stk[t] for t in common]) or 1
my = st.mean([luck[t] for t in common]); sy = st.pstdev([luck[t] for t in common]) or 1
r_ls = st.mean([((stk[t]-mx)/sx) * ((luck[t]-my)/sy) for t in common])
print(f'\ncorr(luck, stack strength) = {r_ls:+.3f}  (confounding check)')

# ---- backtest: 28 played knockout matches ------------------------------------
ko = []
for stg in ('round_of_32','round_of_16','quarterfinals'):
    for k, rec in ar.get(stg, {}).items():
        if rec.get('status') == 'STATUS_SCHEDULED': continue
        a, b = k.split('__vs__')
        w = rec.get('winner')
        if not w:
            sa, sb = rec.get('score_a'), rec.get('score_b')
            w = a if sa > sb else b if sb > sa else None
        if w and a in stk and b in stk:
            ko.append((stg, a, b, w))
print(f'\nknockout sample: {len(ko)} matches')

s_sd = st.pstdev([stk[t] for t in common]) or 1

def two_way(gap):
    """P(A advances) via the pipeline's bivariate-Poisson wdl, draw reallocated."""
    MU, BETA = 0.30, 0.70
    la = math.exp(MU + BETA*gap/2); lb = math.exp(MU - BETA*gap/2)
    fact = [1]*11
    for i in range(1, 11): fact[i] = fact[i-1]*i
    pa = [math.exp(-la)*la**i/fact[i] for i in range(11)]
    pb = [math.exp(-lb)*i2 for i2 in [math.exp(0)]*0] or [math.exp(-lb)*lb**i/fact[i] for i in range(11)]
    h = d = aw = 0
    for i in range(11):
        for j in range(11):
            p = pa[i]*pb[j]
            if i > j: h += p
            elif i == j: d += p
            else: aw += p
    return (h + d/2) / (h + d + aw)

def evaluate(lam, luckmap):
    ll = 0; acc = 0
    for stg, a, b, w in ko:
        gap = (stk[a] + lam*s_sd*luckmap.get(a, 0)) - (stk[b] + lam*s_sd*luckmap.get(b, 0))
        p = two_way(gap)
        pw = p if w == a else 1 - p
        ll -= math.log(max(pw, 1e-9))
        acc += 1 if pw > 0.5 else 0
    return ll/len(ko), acc/len(ko)

print('\n=== BACKTEST: stack + lambda*luck (group-stage luck -> knockout results) ===')
print(f"{'lambda':>7} {'logloss(full)':>14} {'acc':>6}   {'logloss(calls)':>14} {'acc':>6}")
for lam in (0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5):
    l1, a1 = evaluate(lam, luck)
    l2, a2 = evaluate(lam, luck_calls)
    print(f"{lam:>7.2f} {l1:>14.4f} {a1:>6.1%}   {l2:>14.4f} {a2:>6.1%}")

# leave-one-stage-out sanity: fit-free, but check sign stability per round
print('\nper-stage logloss delta (lam=0.15 full luck vs 0):')
for stg in ('round_of_32','round_of_16','quarterfinals'):
    sub = [m for m in ko if m[0] == stg]
    def ev(lam):
        ll = 0
        for _, a, b, w in sub:
            gap = (stk[a]+lam*s_sd*luck.get(a,0)) - (stk[b]+lam*s_sd*luck.get(b,0))
            p = two_way(gap); ll -= math.log(max(p if w==a else 1-p, 1e-9))
        return ll/len(sub)
    print(f'  {stg:15s} n={len(sub):2d}  base={ev(0):.4f}  lam0.15={ev(0.15):.4f}  delta={ev(0.15)-ev(0):+.4f}')

# ---- residualized luck (strength partialled out) + permutation noise test ----
import random
beta = r_ls * sy / sx
resid = {t: luck[t] - (my + beta * (stk[t] - mx)) for t in common}
rmu, rsd = st.mean(list(resid.values())), st.pstdev(list(resid.values())) or 1
resid = {t: (resid[t] - rmu) / rsd for t in common}
print('\n=== RESIDUAL LUCK (strength removed) ===')
for t in REMAIN: print(f'  {t:10s} residual-luck z = {resid[t]:+.2f}')
print(f"{'lambda':>7} {'logloss(resid)':>15} {'acc':>6}")
for lam in (0.0, 0.05, 0.1, 0.15, 0.2, 0.3):
    l, a = evaluate(lam, resid)
    print(f'{lam:>7.2f} {l:>15.4f} {a:>6.1%}')

random.seed(2026)
base_ll, _ = evaluate(0.0, luck)
real_delta = evaluate(0.15, luck)[0] - base_ll
perm = []
vals = [luck[t] for t in common]
for _ in range(500):
    random.shuffle(vals)
    pm = dict(zip(common, vals))
    perm.append(evaluate(0.15, pm)[0] - base_ll)
better = sum(1 for d in perm if d <= real_delta)
print(f'\npermutation test (lam=0.15): real delta={real_delta:+.4f}, '
      f'p={better/len(perm):.2f} ({better}/500 random luck assignments do as well or better)')
