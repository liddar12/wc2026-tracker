#!/usr/bin/env python3
"""Quasi-home / "crowd support" backtest — does a fan-advantage term earn a
place in the knockout projection? (User hypothesis: Argentina's US matches are
quasi-home games — the "Messi effect" — a partisan-crowd edge the model ignores.)

Mirrors scripts/proto/luck_backtest.py so the verdict is directly comparable:
build a per-match crowd-advantage term from REAL geography, add it to the stack
strength with weight lambda, and measure 2-way log-loss on the 28 played
knockout matches. Permutation-test the best lambda and residualize on strength.

Crowd mechanism proxies (two principled encodings, tested separately + combined):
  proximity  great-circle distance from each team's home country to the match
             venue (closer home -> more travelling fans, less jet lag). Zero
             assumptions beyond "closer = more support". Pure geography.
  diaspora   Americas teams draw quasi-home crowds in North-American venues:
             host CONCACAF (USA/MEX/CAN) = 2, other CONCACAF + CONMEBOL = 1
             (the Messi effect), UEFA/CAF/AFC/OFC = 0.
  combined   z(proximity) + z(diaspora).

Home-support enters the model exactly like the luck term did:
  gap = (stack_a + L*s_sd*z_crowd_a) - (stack_b + L*s_sd*z_crowd_b)
so lambda is on the same scale and the two analyses are comparable.
"""
import json, math, statistics as st
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent.parent / "data"
J = lambda p: json.load(open(DATA / p))

# --- team home country centroid (lat, lon) + confederation (reference geo) ----
# Confederations: CMB=CONMEBOL, CCF_HOST=host CONCACAF (USA/MEX/CAN),
# CCF=other CONCACAF, UEFA, CAF, AFC, OFC.
TEAM_GEO = {
    "Argentina": (-38.4, -63.6, "CMB"), "Brazil": (-14.2, -51.9, "CMB"),
    "Colombia": (4.6, -74.3, "CMB"), "Ecuador": (-1.8, -78.2, "CMB"),
    "Paraguay": (-23.4, -58.4, "CMB"), "Uruguay": (-32.5, -55.8, "CMB"),
    "USA": (39.8, -98.6, "CCF_HOST"), "Mexico": (23.6, -102.6, "CCF_HOST"),
    "Canada": (56.1, -106.3, "CCF_HOST"),
    "Panama": (8.5, -80.8, "CCF"), "Haiti": (19.0, -72.3, "CCF"),
    "Curacao": (12.2, -69.0, "CCF"),
    "Austria": (47.5, 14.6, "UEFA"), "Belgium": (50.5, 4.5, "UEFA"),
    "Bosnia and Herzegovina": (43.9, 17.7, "UEFA"), "Croatia": (45.1, 15.2, "UEFA"),
    "Czechia": (49.8, 15.5, "UEFA"), "England": (52.5, -1.5, "UEFA"),
    "France": (46.6, 2.2, "UEFA"), "Germany": (51.2, 10.4, "UEFA"),
    "Netherlands": (52.1, 5.3, "UEFA"), "Norway": (60.5, 8.5, "UEFA"),
    "Portugal": (39.6, -8.0, "UEFA"), "Scotland": (56.5, -4.2, "UEFA"),
    "Spain": (40.2, -3.6, "UEFA"), "Sweden": (60.1, 18.6, "UEFA"),
    "Switzerland": (46.8, 8.2, "UEFA"), "Turkiye": (39.0, 35.2, "UEFA"),
    "Algeria": (28.0, 1.7, "CAF"), "Cabo Verde": (16.0, -24.0, "CAF"),
    "Cote d'Ivoire": (7.5, -5.5, "CAF"), "DR Congo": (-4.0, 21.8, "CAF"),
    "Egypt": (26.8, 30.8, "CAF"), "Ghana": (7.9, -1.0, "CAF"),
    "Morocco": (31.8, -7.1, "CAF"), "Senegal": (14.5, -14.4, "CAF"),
    "South Africa": (-30.6, 22.9, "CAF"), "Tunisia": (33.9, 9.5, "CAF"),
    "Australia": (-25.3, 133.8, "AFC"), "Iran": (32.4, 53.7, "AFC"),
    "Iraq": (33.2, 43.7, "AFC"), "Japan": (36.2, 138.3, "AFC"),
    "Jordan": (30.6, 36.2, "AFC"), "Korea Republic": (35.9, 127.8, "AFC"),
    "Qatar": (25.3, 51.2, "AFC"), "Saudi Arabia": (23.9, 45.1, "AFC"),
    "Uzbekistan": (41.4, 64.6, "AFC"), "New Zealand": (-40.9, 174.9, "OFC"),
}
DIASPORA = {"CCF_HOST": 2.0, "CCF": 1.0, "CMB": 1.0, "UEFA": 0.0, "CAF": 0.0, "AFC": 0.0, "OFC": 0.0}

def haversine(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(d))

venues = {v["id"]: v for v in J("venues.json")}
def venue_ll(vid):
    v = venues.get(vid)
    return (v["lat"], v["lon"]) if v else None

def proximity_raw(team, vll):
    """Higher = closer home. exp(-distance/3000km) decay (fans + jet lag)."""
    g = TEAM_GEO.get(team)
    if not g or not vll: return None
    d = haversine((g[0], g[1]), vll)
    return math.exp(-d / 3000.0)

def diaspora_raw(team):
    g = TEAM_GEO.get(team)
    return DIASPORA.get(g[2], 0.0) if g else 0.0

# --- build the 28 played-knockout sample -------------------------------------
sched = J("schedule_full.json"); ms = sched["matches"] if isinstance(sched, dict) and "matches" in sched else sched
venue_of = {}
for m in ms:
    if m.get("team_a") and m.get("team_b"):
        venue_of[(m["team_a"], m["team_b"])] = m.get("venue_id")
        venue_of[(m["team_b"], m["team_a"])] = m.get("venue_id")

stk = J("stacker.json")["strengths"]
ar = J("actual_results.json")
sample = []  # (a, b, winner, venue_id)
for stg in ("round_of_32", "round_of_16", "quarterfinals"):
    for k, rec in ar.get(stg, {}).items():
        if rec.get("status") == "STATUS_SCHEDULED": continue
        a, b = k.split("__vs__")
        w = rec.get("winner")
        if not w:
            sa, sb = rec.get("score_a"), rec.get("score_b")
            w = a if (sa or 0) > (sb or 0) else b if (sb or 0) > (sa or 0) else None
        if w and a in stk and b in stk:
            sample.append((a, b, w, venue_of.get((a, b))))
print(f"knockout sample: {len(sample)} matches")

# --- home-support indices, z-scored across all team-match observations --------
def build_index(fn):
    obs = []
    for a, b, _, vid in sample:
        vll = venue_ll(vid)
        for t in (a, b):
            val = fn(t, vll) if fn.__code__.co_argcount == 2 else fn(t)
            if val is not None: obs.append(val)
    mu, sd = st.mean(obs), st.pstdev(obs) or 1
    return lambda t, vll=None: ((fn(t, vll) if fn.__code__.co_argcount == 2 else fn(t)) - mu) / sd

z_prox = build_index(proximity_raw)
z_dia = build_index(diaspora_raw)
def z_combined(t, vll):
    return z_prox(t, vll) + z_dia(t)

common = list(stk.keys())
s_sd = st.pstdev([stk[t] for t in common]) or 1

LOG_FACT = [0.0]
for k in range(1, 12): LOG_FACT.append(LOG_FACT[-1] + math.log(k))
def two_way(gap):
    MU, BETA = 0.30, 0.70
    la, lb = math.exp(MU + BETA * gap / 2), math.exp(MU - BETA * gap / 2)
    pa = [math.exp(k * math.log(la) - la - LOG_FACT[k]) for k in range(11)]
    pb = [math.exp(k * math.log(lb) - lb - LOG_FACT[k]) for k in range(11)]
    h = d = aw = 0.0
    for i in range(11):
        for j in range(11):
            p = pa[i] * pb[j]
            if i > j: h += p
            elif i == j: d += p
            else: aw += p
    return (h + d / 2) / (h + d + aw)

def evaluate(lam, zfn):
    ll = acc = 0.0
    for a, b, w, vid in sample:
        vll = venue_ll(vid)
        za = zfn(a, vll); zb = zfn(b, vll)
        gap = (stk[a] + lam * s_sd * za) - (stk[b] + lam * s_sd * zb)
        p = two_way(gap)
        pw = p if w == a else 1 - p
        ll -= math.log(max(pw, 1e-9)); acc += 1 if pw > 0.5 else 0
    return ll / len(sample), acc / len(sample)

print("\n=== BACKTEST: stack + lambda*crowd (2-way logloss on 28 played KOs) ===")
print(f"{'lambda':>7} | {'proximity':>18} | {'diaspora':>18} | {'combined':>18}")
print(f"{'':>7} | {'logloss':>10}{'acc':>8} | {'logloss':>10}{'acc':>8} | {'logloss':>10}{'acc':>8}")
for lam in (0.0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50):
    row = []
    for zfn in (z_prox, z_dia, z_combined):
        l, a = evaluate(lam, zfn)
        row.append(f"{l:>10.4f}{a:>7.1%}")
    print(f"{lam:>7.2f} | {row[0]:>18} | {row[1]:>18} | {row[2]:>18}")

# --- confounding: does crowd just re-encode strength? ------------------------
def team_avg_z(zfn):
    m = {}
    for a, b, _, vid in sample:
        vll = venue_ll(vid)
        for t in (a, b): m.setdefault(t, zfn(t, vll))
    return m
for label, zfn in (("proximity", z_prox), ("diaspora", z_dia), ("combined", z_combined)):
    tz = team_avg_z(zfn)
    ts = [t for t in tz if t in stk]
    mx, sx = st.mean([stk[t] for t in ts]), st.pstdev([stk[t] for t in ts]) or 1
    my, sy = st.mean([tz[t] for t in ts]), st.pstdev([tz[t] for t in ts]) or 1
    r = st.mean([((stk[t]-mx)/sx)*((tz[t]-my)/sy) for t in ts])
    print(f"corr({label}, stack strength) = {r:+.3f}")

# --- permutation test on the best variant (combined, lam=0.15) ---------------
import hashlib
def seeded_shuffle(items, salt):
    # deterministic shuffle (Date/random unavailable-safe): sort by hash(salt+item)
    return sorted(items, key=lambda x: hashlib.md5(f"{salt}{x}".encode()).hexdigest())
base_ll, _ = evaluate(0.0, z_combined)
real_delta = evaluate(0.15, z_combined)[0] - base_ll
teams_in = list(team_avg_z(z_combined).keys())
zc_by_team = team_avg_z(z_combined)
perm_better = 0; N = 500
for s in range(N):
    perm_teams = seeded_shuffle(teams_in, f"crowd{s}")
    perm_map = {perm_teams[i]: zc_by_team[teams_in[i]] for i in range(len(teams_in))}
    def zperm(t, vll=None): return perm_map.get(t, 0.0)
    d = evaluate(0.15, zperm)[0] - base_ll
    if d <= real_delta: perm_better += 1
print(f"\npermutation test (combined, lam=0.15): real delta={real_delta:+.4f}, "
      f"p={perm_better/N:.2f} ({perm_better}/{N} random crowd assignments do as well or better)")

# --- what the term SAYS about tonight's final (Spain vs Argentina @ MetLife) --
print("\n=== tonight's final — Spain vs Argentina @ MetLife (East Rutherford) ===")
mv = venue_ll("metlife")
for t in ("Argentina", "Spain"):
    g = TEAM_GEO[t]
    d = haversine((g[0], g[1]), mv)
    print(f"  {t:10s} conf={g[2]:9s} home->venue {d:6.0f} km  prox_z={z_prox(t, mv):+.2f}  "
          f"diaspora_z={z_dia(t):+.2f}  combined_z={z_combined(t, mv):+.2f}")
base_gap = stk["Spain"] - stk["Argentina"]
print(f"  base stack gap (Spain - Argentina) = {base_gap:+.3f}  -> Spain P(adv) = {two_way(base_gap):.1%}")
for lam in (0.10, 0.15, 0.20):
    za, zs = z_combined("Argentina", mv), z_combined("Spain", mv)
    gap = (stk["Spain"] + lam*s_sd*zs) - (stk["Argentina"] + lam*s_sd*za)
    print(f"  + crowd (lam={lam:.2f}): Spain P(adv) = {two_way(gap):.1%}  "
          f"(Argentina gains {two_way(base_gap)-two_way(gap):+.1%})")
