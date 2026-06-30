#!/usr/bin/env python3
"""Build the HYBRID forecast — an equal 1/3 blend of J5L + DT + Kalshi.

    hybrid_strength = z( ( z(J5L composite) + z(DT rating) + z(Kalshi strength) ) / 3 )

Kalshi strength = implied from the (populated) tournament-winner odds, since
per-match Kalshi odds (`match_outcomes`) ship empty. The single hybrid rating
drives EVERY level via one bivariate-Poisson + Monte-Carlo engine:
  * group match W/D/L  -> data/group_matchups.json `probabilities` (the default
    bars; the prior J5L probs are preserved under `j5l_probabilities`)
  * bracket reach + champion odds -> data/forecast.json (group→bracket→finals)

Reads data/{teams,dt_model,markets,group_matchups}.json (all live, cron-fed), so
re-running on cron keeps every prediction dynamic game-to-game and day-to-day.
Run:  python3 scripts/build_hybrid.py   (after rebuild_composite + build_dt_model)
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections import OrderedDict
from datetime import datetime, timezone
from itertools import combinations

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dpath(f):
    return os.path.join(ROOT, "data", f)


def load(f):
    return json.load(open(dpath(f)))


def save_atomic(f, data):
    """Atomic JSON write (tmp + os.replace) with ensure_ascii=True.

    Atomic so a crash mid-write never leaves group_matchups.json truncated for
    the next cron / the live UI. ensure_ascii=True matches the on-disk encoding
    of every data/*.json (the repo convention) and keeps the diff stable so this
    co-writer doesn't fight rebuild_composite over the same file.
    """
    path = dpath(f)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=True, indent=2)
        fh.write("\n")
    os.replace(tmp, path)


W = (1 / 3, 1 / 3, 1 / 3)          # J5L, DT, Kalshi (default; meta.hybrid_weights overrides)
MU, BETA, LAMBDA3, PEN_BETA = 0.30, 0.70, 0.12, 0.35
N_SIMS, SEED = 20000, 2026
KALSHI_FLOOR = 0.05                 # title-prob floor (%) for unlisted long-shots


def zscore(x):
    x = np.asarray(x, float)
    s = x.std()
    return (x - x.mean()) / s if s > 0 else np.zeros_like(x)


def _pois(k, lam):
    return math.exp(k * math.log(lam) - lam - math.lgamma(k + 1))


def wdl(gap):
    """Analytic bivariate-Poisson W/D/L (A win, draw, B win) for a rating gap."""
    sup = BETA * gap
    la, lb = math.exp(MU + sup / 2), math.exp(MU - sup / 2)
    pa = [_pois(k, la) for k in range(11)]
    pb = [_pois(k, lb) for k in range(11)]
    h = d = a = 0.0
    for i in range(11):
        for j in range(11):
            p = pa[i] * pb[j]
            if i > j:
                h += p
            elif i == j:
                d += p
            else:
                a += p
    t = h + d + a
    return h / t, d / t, a / t


def _seed_order(n=32):
    order = [1, 2]
    while len(order) < n:
        size = len(order) * 2
        order = [v for s in order for v in (s, size + 1 - s)]
    return [s - 1 for s in order]


def monte_carlo(groups, ratings, nteams):
    rng = np.random.default_rng(SEED)
    ratings = np.asarray(ratings, float)
    n = N_SIMS

    def goals(a, b):
        sup = BETA * (ratings[a] - ratings[b])
        la, lb = np.exp(MU + sup / 2), np.exp(MU - sup / 2)
        sh = rng.poisson(LAMBDA3, size=a.shape)
        return (rng.poisson(np.clip(la - LAMBDA3, 1e-6, None)) + sh,
                rng.poisson(np.clip(lb - LAMBDA3, 1e-6, None)) + sh)

    reach = {r: np.zeros(nteams, dtype=np.int64) for r in
             ["R32", "R16", "QF", "SF", "Final", "Champion"]}
    win, run, thr, tk = [], [], [], []
    for ids in groups:
        pts = np.zeros((n, 4)); gd = np.zeros((n, 4)); gf = np.zeros((n, 4))
        for x, y in combinations(range(4), 2):
            a = np.full(n, ids[x]); b = np.full(n, ids[y])
            ga, gb = goals(a, b)
            aw = ga > gb; bw = gb > ga; dr = ga == gb
            pts[:, x] += 3 * aw + dr; pts[:, y] += 3 * bw + dr
            gd[:, x] += ga - gb; gd[:, y] += gb - ga; gf[:, x] += ga; gf[:, y] += gb
        key = pts * 1e6 + gd * 1e3 + gf + rng.random((n, 4)) * 1e-3
        o = np.argsort(-key, axis=1)
        win.append(ids[o[:, 0]]); run.append(ids[o[:, 1]]); thr.append(ids[o[:, 2]])
        tk.append(np.take_along_axis(key, o[:, 2:3], axis=1)[:, 0])
    third_ids = np.stack(thr, axis=1)
    best8 = np.argsort(-np.stack(tk, axis=1), axis=1)[:, :8]
    qual = np.concatenate([np.stack(win, 1), np.stack(run, 1),
                           np.take_along_axis(third_ids, best8, axis=1)], axis=1)
    for c in range(qual.shape[1]):
        np.add.at(reach["R32"], qual[:, c], 1)
    seeded = np.take_along_axis(qual, np.argsort(-ratings[qual], axis=1), axis=1)
    slots = np.empty_like(seeded); slots[:, _seed_order(32)] = seeded
    rname = {32: "R16", 16: "QF", 8: "SF", 4: "Final", 2: "Champion"}
    while slots.shape[1] > 1:
        m = slots.shape[1]; nxt = np.empty((n, m // 2), dtype=slots.dtype)
        for k in range(0, m, 2):
            a = slots[:, k]; b = slots[:, k + 1]
            ga, gb = goals(a, b)
            w = np.where(ga > gb, a, b); tie = ga == gb
            if tie.any():
                pa = 1 / (1 + np.exp(-PEN_BETA * (ratings[a[tie]] - ratings[b[tie]])))
                w[tie] = np.where(rng.random(int(tie.sum())) < pa, a[tie], b[tie])
            nxt[:, k // 2] = w
        for c in range(nxt.shape[1]):
            np.add.at(reach[rname[m]], nxt[:, c], 1)
        slots = nxt
    return {r: reach[r] / float(n) for r in reach}


def main():
    teams = load("teams.json")
    names = list(teams.keys())
    idx = {n: i for i, n in enumerate(names)}

    # optimize_weights may tune the J5L/DT/Kalshi blend; fall back to equal thirds.
    meta = load("meta.json")
    hw = meta.get("hybrid_weights")
    blend = tuple(hw) if isinstance(hw, (list, tuple)) and len(hw) == 3 else W

    # --- three signals, z-scored across the 48 teams ---
    z_j5l = zscore([teams[n].get("composite") or 0 for n in names])
    dt_rating = {r["country"]: r["rating"] for r in load("dt_model.json").get("team_rankings", [])}
    z_dt = zscore([dt_rating.get(n, 0) for n in names])
    kal = {r["team"]: r.get("prob_pct", 0) for r in load("markets.json").get("tournament_winner", [])}
    z_kal = zscore([math.log(max(kal.get(n, 0.0), KALSHI_FLOOR)) for n in names])

    hybrid = zscore(blend[0] * z_j5l + blend[1] * z_dt + blend[2] * z_kal)  # standardised rating

    # --- group match bars = per-match ⅓ probability blend (J5L + DT + Kalshi) ---
    # Each model contributes a W/D/L distribution; the Kalshi third uses REAL
    # per-match odds (markets.match_outcomes, from the KXWCGAME scraper) when a game
    # is priced, otherwise its tournament-strength view. So the bars become a true
    # ⅓-at-the-match-level blend automatically as Kalshi prices each match.
    try:
        mo = (load("markets.json") or {}).get("match_outcomes") or {}
    except Exception:
        mo = {}
    gm = load("group_matchups.json")
    changed = kalshi_live = 0
    for g in gm.values():
        for m in g["matches"]:
            a, b = idx.get(m["team_a"]), idx.get(m["team_b"])
            if a is None or b is None:
                continue
            # J5L: the composite-based probs rebuild_composite just wrote
            jp = m.get("probabilities") or {}
            j = (jp.get("team_a_wins", 0) / 100, jp.get("draw", 0) / 100, jp.get("team_b_wins", 0) / 100)
            if sum(j) <= 0:
                j = wdl(float(z_j5l[a] - z_j5l[b]))
            # DT: bivariate-Poisson on the DT-rating gap
            d = wdl(float(z_dt[a] - z_dt[b]))
            # Kalshi: real per-match odds if priced, else strength-derived
            key, rev = f"{m['team_a']}__vs__{m['team_b']}", f"{m['team_b']}__vs__{m['team_a']}"
            o = mo.get(key)
            if o and o.get("team_a_prob") is not None:
                k = (o["team_a_prob"], o["draw_prob"], o["team_b_prob"]); kalshi_live += 1
            elif mo.get(rev) and mo[rev].get("team_a_prob") is not None:
                o = mo[rev]; k = (o["team_b_prob"], o["draw_prob"], o["team_a_prob"]); kalshi_live += 1
            else:
                k = wdl(float(z_kal[a] - z_kal[b]))
            pa = blend[0] * j[0] + blend[1] * d[0] + blend[2] * k[0]
            pd = blend[0] * j[1] + blend[1] * d[1] + blend[2] * k[1]
            pb = blend[0] * j[2] + blend[1] * d[2] + blend[2] * k[2]
            tot = pa + pd + pb or 1.0
            pa, pd, pb = pa / tot, pd / tot, pb / tot
            m["j5l_probabilities"] = jp or m.get("j5l_probabilities")  # preserve fresh J5L
            m["probabilities"] = {"team_a_wins": round(pa * 100, 1),
                                  "draw": round(pd * 100, 1),
                                  "team_b_wins": round(pb * 100, 1)}
            m["expected_points"] = {"team_a": round(pa * 3 + pd, 2),
                                    "team_b": round(pb * 3 + pd, 2)}
            if abs(pa - pb) < 0.04:
                m["predicted_winner"] = "draw_likely"
                m["win_confidence_pct"] = round(max(pa, pb) * 100, 1)
            elif pa > pb:
                m["predicted_winner"] = m["team_a"]; m["win_confidence_pct"] = round(pa * 100, 1)
            else:
                m["predicted_winner"] = m["team_b"]; m["win_confidence_pct"] = round(pb * 100, 1)
            changed += 1
    # Atomic swap: the full ⅓ blend is computed in-memory above, so we only
    # overwrite group_matchups.json once the WHOLE blend succeeded. A crash
    # mid-loop (above) raises before this line and leaves the previous file
    # intact — no half-blended probabilities, no predicted_winner flicker.
    save_atomic("group_matchups.json", gm)

    # --- Monte-Carlo bracket → forecast.json (group→bracket→finals) ---
    gmap = OrderedDict()
    for n in names:
        gmap.setdefault(teams[n].get("group"), []).append(idx[n])
    groups = [np.array(v) for _, v in sorted(gmap.items())]
    for gl, ids in zip(sorted(gmap), groups):
        if len(ids) != 4:
            print(f"ERROR group {gl}: {len(ids)} teams", file=sys.stderr); return 1
    reach = monte_carlo(groups, hybrid, len(names))

    order = np.argsort(-reach["Champion"])
    rows = []
    for rank, i in enumerate(order, start=1):
        rows.append({
            "rank": rank, "team": names[i],
            "champion": round(float(reach["Champion"][i]), 4),
            "final": round(float(reach["Final"][i]), 4),
            "sf": round(float(reach["SF"][i]), 4),
            "qf": round(float(reach["QF"][i]), 4),
            "r16": round(float(reach["R16"][i]), 4),
            "r32": round(float(reach["R32"][i]), 4),
            "hybrid_strength": round(float(hybrid[i]), 3),
        })
    forecast = {
        "model": {
            "id": "hybrid", "name": "Hybrid",
            "version": "1.0",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "weights": {"j5l": round(blend[0], 4), "dt": round(blend[1], 4), "kalshi": round(blend[2], 4)},
            "method": "Equal 1/3 blend of J5L composite + DT rating + Kalshi implied strength; "
                      "bivariate-Poisson Monte-Carlo of the 48-team/12-group bracket.",
            "note": "Group bars blend ⅓ each at the match level, using REAL per-match Kalshi "
                    "odds (KXWCGAME) where priced and tournament-winner strength otherwise. "
                    "Champion odds use the blended strength. Recomputed each data refresh.",
        },
        "bracket_simulation": {"iterations": N_SIMS, "seed": SEED},
        "teams": rows,
    }
    save_atomic("forecast.json", forecast)
    print(f"hybrid: group bars updated ({changed}) · forecast champion top="
          f"{rows[0]['team']} {rows[0]['champion'] * 100:.1f}% · champ sum "
          f"{sum(r['champion'] for r in rows):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
