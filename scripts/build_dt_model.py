#!/usr/bin/env python3
"""Build data/dt_model.json — the DT model rebuilt as the validated combo:

    rating = 0.60 * z(Elo) + 0.40 * z(log squad market value)   [un-dormants DT's
    talent layer with live Transfermarkt value from data/teams.json]

title odds come from a bivariate-Poisson + Monte-Carlo of the real 48-team /
12-group bracket (the V3 engine). Reads data/teams.json (live, cron-fed). Output
schema matches app/lib/dt-model.js: team_rankings[].{country, rating, title_prob,
rank, components{elo_z, talent_z, ...}}.

Run:  python3 scripts/build_dt_model.py
"""
from __future__ import annotations

import json
import os
import sys
from collections import OrderedDict
from datetime import datetime, timezone
from itertools import combinations

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dpath(f: str) -> str:
    return os.path.join(ROOT, "data", f)


# blend + match-model params (V3 engine defaults; rating is standardised first)
W_ELO = 0.60
W_MARKET = 0.40
MU = 0.30
BETA = 0.70
LAMBDA3 = 0.12
PEN_BETA = 0.35
N_SIMS = 20000
SEED = 2026


def zscore(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    s = x.std()
    return (x - x.mean()) / s if s > 0 else np.zeros_like(x)


def _seed_order(n: int = 32):
    order = [1, 2]
    while len(order) < n:
        size = len(order) * 2
        nxt = []
        for s in order:
            nxt += [s, size + 1 - s]
        order = nxt
    return [s - 1 for s in order]


def monte_carlo(groups, ratings, nteams):
    rng = np.random.default_rng(SEED)
    ratings = np.asarray(ratings, dtype=float)
    n = N_SIMS

    def sample_goals(a, b):
        sup = BETA * (ratings[a] - ratings[b])
        la = np.exp(MU + sup / 2.0)
        lb = np.exp(MU - sup / 2.0)
        shared = rng.poisson(LAMBDA3, size=a.shape)
        ga = rng.poisson(np.clip(la - LAMBDA3, 1e-6, None)) + shared
        gb = rng.poisson(np.clip(lb - LAMBDA3, 1e-6, None)) + shared
        return ga, gb

    winners, runners, thirds, tkeys = [], [], [], []
    for ids in groups:
        pts = np.zeros((n, 4)); gd = np.zeros((n, 4)); gf = np.zeros((n, 4))
        for x, y in combinations(range(4), 2):
            a = np.full(n, ids[x]); b = np.full(n, ids[y])
            ga, gb = sample_goals(a, b)
            aw = ga > gb; bw = gb > ga; dr = ga == gb
            pts[:, x] += 3 * aw + dr; pts[:, y] += 3 * bw + dr
            gd[:, x] += ga - gb; gd[:, y] += gb - ga
            gf[:, x] += ga; gf[:, y] += gb
        key = pts * 1e6 + gd * 1e3 + gf + rng.random((n, 4)) * 1e-3
        order = np.argsort(-key, axis=1)
        winners.append(ids[order[:, 0]]); runners.append(ids[order[:, 1]])
        thirds.append(ids[order[:, 2]])
        tkeys.append(np.take_along_axis(key, order[:, 2:3], axis=1)[:, 0])

    third_ids = np.stack(thirds, axis=1)
    third_k = np.stack(tkeys, axis=1)
    best8 = np.argsort(-third_k, axis=1)[:, :8]
    best_thirds = np.take_along_axis(third_ids, best8, axis=1)
    qual = np.concatenate(
        [np.stack(winners, axis=1), np.stack(runners, axis=1), best_thirds], axis=1
    )  # [n, 32]

    seed_ord = np.argsort(-ratings[qual], axis=1)
    seeded = np.take_along_axis(qual, seed_ord, axis=1)
    pos = _seed_order(32)
    slots = np.empty_like(seeded)
    slots[:, pos] = seeded

    while slots.shape[1] > 1:
        m = slots.shape[1]
        nxt = np.empty((n, m // 2), dtype=slots.dtype)
        for k in range(0, m, 2):
            a = slots[:, k]; b = slots[:, k + 1]
            ga, gb = sample_goals(a, b)
            win = np.where(ga > gb, a, b)
            tie = ga == gb
            if tie.any():
                pa = 1.0 / (1.0 + np.exp(-PEN_BETA * (ratings[a[tie]] - ratings[b[tie]])))
                aw = rng.random(int(tie.sum())) < pa
                win[tie] = np.where(aw, a[tie], b[tie])
            nxt[:, k // 2] = win
        slots = nxt

    champ = np.zeros(nteams, dtype=np.int64)
    np.add.at(champ, slots[:, 0], 1)
    return champ / float(n)


def main() -> int:
    teams = json.load(open(dpath("teams.json")))
    names = list(teams.keys())
    elo = np.array([teams[n].get("elo_raw") or 1500 for n in names], dtype=float)
    tmv = np.array([teams[n].get("tmv_musd") or 1.0 for n in names], dtype=float)
    group_lbl = [teams[n].get("group") for n in names]

    z_elo = zscore(elo)
    z_tmv = zscore(np.log(np.clip(tmv, 1e-9, None)))
    rating_z = zscore(W_ELO * z_elo + W_MARKET * z_tmv)  # standardised for the engine

    r = rating_z - rating_z.min()
    rating100 = 100.0 * r / r.max() if r.max() > 0 else r

    # group label -> team indices (validate 12 groups of 4)
    gmap = OrderedDict()
    for i, g in enumerate(group_lbl):
        gmap.setdefault(g, []).append(i)
    groups = [np.array(v) for _, v in sorted(gmap.items())]
    for g, ids in zip(sorted(gmap), groups):
        if len(ids) != 4:
            print(f"ERROR: group {g} has {len(ids)} teams (expected 4)", file=sys.stderr)
            return 1

    title = monte_carlo(groups, rating_z, len(names))

    order = np.argsort(-rating100)
    rankings = []
    for rank, i in enumerate(order, start=1):
        rankings.append({
            "rank": rank,
            "country": names[i],
            "rating": round(float(rating100[i]), 1),
            "title_prob": round(float(title[i]), 4),
            "components": {
                "attack": 0.0, "midfield": 0.0, "defense": 0.0, "gk": 0.0, "coach": 0.0,
                "talent_z": round(float(z_tmv[i]), 3),   # NON-zero: live market value
                "elo_z": round(float(z_elo[i]), 3),
            },
        })

    out = {
        "model": {
            "id": "dt_model",
            "name": "DT Model",
            "version": "3.0",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "method": "Elo + squad market value blend (0.6/0.4), bivariate-Poisson Monte-Carlo bracket",
            "elo_anchored": True,
            "w_elo": W_ELO,
            "w_market": W_MARKET,
            "note": "Talent layer = standardised log squad market value (Transfermarkt, live teams.json). "
                    "Title odds from the V3 bivariate-Poisson engine over the 48-team/12-group bracket.",
        },
        "team_rankings": rankings,
        "bracket_simulation": {"iterations": N_SIMS, "title_prob_included": True, "seed": SEED},
    }
    json.dump(out, open(dpath("dt_model.json"), "w"), indent=2)
    print(f"dt_model.json: {len(names)} teams · top={rankings[0]['country']} "
          f"(rating {rankings[0]['rating']}, title {rankings[0]['title_prob'] * 100:.1f}%) · "
          f"talent_z range [{min(r['components']['talent_z'] for r in rankings):.2f}, "
          f"{max(r['components']['talent_z'] for r in rankings):.2f}] (non-zero ⇒ un-dormant)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
