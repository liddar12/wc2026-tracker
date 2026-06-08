#!/usr/bin/env python3
"""Live WC 2026 backtest capture — the first REAL 4-model backtest.

For every match it (1) locks the pre-kickoff W/D/L from all five forecasters —
J5L, DT, Market (Kalshi), Polymarket, and the Hybrid — refreshing until kickoff
so the locked snapshot is the sharpest pre-match read, then (2) scores each one
against the actual result as it lands (accuracy + multiclass Brier + log-loss).

Model math is IMPORTED from build_hybrid (same zscore/wdl/weights), so captured
predictions cannot drift from the live model. Run AFTER build_hybrid in the cron:
    python3 scripts/snapshot_backtest.py
Writes data/live-backtest.json (per-match detail) and merges a summary into
data/backtest.json → live2026 (rendered by the Backtest view).

Public Gamma API for Polymarket (no auth). ESPN-fed data/actual_results.json for
ground truth. Group stage is fully supported now; knockouts join automatically
once their pairings + markets exist (their 3-way uses the regulation result).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_hybrid as bh  # noqa: E402  (zscore, wdl, load, dpath, KALSHI_FLOOR)

GAMMA = "https://gamma-api.polymarket.com"
PM_TAG = "102232"            # "fifa-world-cup" tag — enumerates the fifwc-* match events
PM_PREFIX = "fifwc-"
# The full-match 3-way moneyline slug ends exactly at the date — this excludes
# the same-teams prop variants (…-halftime-result, …-exact-score, …-more-markets)
# that would otherwise collide on the team-set key and clobber the moneyline.
PM_MONEYLINE = re.compile(r"^fifwc-.+-\d{4}-\d{2}-\d{2}$")
UA = {"User-Agent": "wc26-tracker/1.0 (live-backtest)", "Accept": "application/json"}
CAPTURE_LEAD_HRS = 36        # start (and keep refreshing) the snapshot this long before kickoff
FINAL_STATUS = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME"}
STAGES = ["group_stage", "round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final"]
MODELS = ["model", "dt", "market", "polymarket", "hybrid"]
EPS = 1e-6

# Polymarket / display team name → canonical teams.json key.
PM_ALIAS = {
    "United States": "USA", "South Korea": "Korea Republic", "Türkiye": "Turkiye",
    "Turkey": "Turkiye", "Czech Republic": "Czechia", "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Cote d'Ivoire", "Congo DR": "DR Congo",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina", "Curaçao": "Curacao", "IR Iran": "Iran",
}


def log(m): print(f"[live-bt] {m}", file=sys.stderr, flush=True)
def canon(n): return PM_ALIAS.get((n or "").strip(), (n or "").strip())


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                log(f"GET fail {url[:70]}…: {e}"); return None
            time.sleep(1.0 + i)
    return None


def as_list(v):
    if isinstance(v, list): return v
    if isinstance(v, str):
        try: return json.loads(v)
        except Exception: return []  # noqa: BLE001
    return []


def parse_iso(s):
    if not s: return None
    s = str(s).strip().replace(" ", "T")
    if s.endswith("Z"): s = s[:-1] + "+00:00"
    elif s.endswith("+00"): s = s[:-3] + "+00:00"
    try:
        d = datetime.fromisoformat(s)
        if d.tzinfo is None: d = d.replace(tzinfo=timezone.utc)
        return int(d.timestamp())
    except Exception:  # noqa: BLE001
        return None


# ---- model signals (identical to build_hybrid) -----------------------------
def build_signals():
    teams = bh.load("teams.json")
    names = list(teams.keys())
    idx = {n: i for i, n in enumerate(names)}
    z_j5l = bh.zscore([teams[n].get("composite") or 0 for n in names])
    dt_rating = {r["country"]: r["rating"] for r in bh.load("dt_model.json").get("team_rankings", [])}
    z_dt = bh.zscore([dt_rating.get(n, 0) for n in names])
    kal = {r["team"]: r.get("prob_pct", 0) for r in bh.load("markets.json").get("tournament_winner", [])}
    z_kal = bh.zscore([math.log(max(kal.get(n, 0.0), bh.KALSHI_FLOOR)) for n in names])
    mo = (bh.load("markets.json") or {}).get("match_outcomes") or {}
    j5lp = {}
    for g in bh.load("group_matchups.json").values():
        for m in g["matches"]:
            jp = m.get("j5l_probabilities") or m.get("probabilities")
            if jp:
                j5lp[(m["team_a"], m["team_b"])] = jp
    return dict(idx=idx, z_j5l=z_j5l, z_dt=z_dt, z_kal=z_kal, mo=mo, j5lp=j5lp)


def model_preds(a, b, sig):
    """W/D/L (a-win, draw, b-win) per model for pairing (a vs b). None if unknown teams."""
    ia, ib = sig["idx"].get(a), sig["idx"].get(b)
    if ia is None or ib is None:
        return None
    # J5L — prefer the persisted composite probs (faithful), else strength-derived
    jp = sig["j5lp"].get((a, b))
    if jp:
        j = (jp["team_a_wins"] / 100, jp["draw"] / 100, jp["team_b_wins"] / 100)
    else:
        rp = sig["j5lp"].get((b, a))
        if rp:
            j = (rp["team_b_wins"] / 100, rp["draw"] / 100, rp["team_a_wins"] / 100)
        else:
            j = bh.wdl(float(sig["z_j5l"][ia] - sig["z_j5l"][ib]))
    # DT — bivariate-Poisson on DT-rating gap
    d = bh.wdl(float(sig["z_dt"][ia] - sig["z_dt"][ib]))
    # Market (Kalshi) — real per-match odds if priced, else tournament-strength
    mo, key, rev = sig["mo"], f"{a}__vs__{b}", f"{b}__vs__{a}"
    o = mo.get(key)
    if o and o.get("team_a_prob") is not None:
        k = (o["team_a_prob"], o["draw_prob"], o["team_b_prob"])
    elif mo.get(rev) and mo[rev].get("team_a_prob") is not None:
        o = mo[rev]; k = (o["team_b_prob"], o["draw_prob"], o["team_a_prob"])
    else:
        k = bh.wdl(float(sig["z_kal"][ia] - sig["z_kal"][ib]))
    # Hybrid — equal ⅓ blend at match level (== build_hybrid's persisted bars)
    h = [(j[i] + d[i] + k[i]) / 3 for i in range(3)]
    t = sum(h) or 1.0
    h = [x / t for x in h]
    return {"model": list(j), "dt": list(d), "market": list(k), "hybrid": h}


# ---- Polymarket live per-match ---------------------------------------------
def polymarket_index():
    """{frozenset({canonA,canonB}): {'probs': {canonA:pa, canonB:pb, 'draw':pd}}} from live fifwc-* events."""
    out = {}
    for offset in (0, 100, 200, 300):
        evs = get(f"{GAMMA}/events?tag_id={PM_TAG}&limit=100&offset={offset}") or []
        fif = [e for e in evs if PM_MONEYLINE.match(e.get("slug") or "")]
        for e in fif:
            legs = {}
            for m in e.get("markets", []):
                git = (m.get("groupItemTitle") or "").strip()
                op = as_list(m.get("outcomePrices"))
                if not git or not op:
                    continue
                price = float(op[0])
                label = "draw" if git.lower().startswith("draw") else canon(git)
                legs[label] = price
            if "draw" not in legs or len(legs) != 3:
                continue
            teams = [t for t in legs if t != "draw"]
            tot = sum(legs.values()) or 1.0
            probs = {t: legs[t] / tot for t in legs}
            out[frozenset(teams)] = {"probs": probs}
        if len(evs) < 100:   # last page reached
            break
    return out


def pm_preds(a, b, pm_idx):
    e = pm_idx.get(frozenset({a, b}))
    if not e:
        return None
    p = e["probs"]
    if a not in p or b not in p:
        return None
    return [p[a], p["draw"], p[b]]


# ---- scoring ----------------------------------------------------------------
def find_result(actual, mid):
    for stg in STAGES:
        rec = (actual.get(stg) or {}).get(mid)
        if rec and rec.get("status") in FINAL_STATUS and rec.get("score_a") is not None and rec.get("score_b") is not None:
            return rec
    return None


def outcome_index(rec):
    sa, sb = rec["score_a"], rec["score_b"]
    return 0 if sa > sb else (2 if sb > sa else 1)  # 0=a-win, 1=draw, 2=b-win


def score_preds(preds, oi):
    out = {}
    for k, p in preds.items():
        if not p:
            continue
        pred_i = max(range(3), key=lambda i: p[i])
        brier = sum((p[i] - (1.0 if i == oi else 0.0)) ** 2 for i in range(3))
        logloss = -math.log(min(max(p[oi], EPS), 1 - EPS))
        out[k] = {"correct": int(pred_i == oi), "brier": round(brier, 5), "logloss": round(logloss, 5)}
    return out


def summarize(matches):
    agg = {k: {"correct": 0, "total": 0, "brier": 0.0, "logloss": 0.0} for k in MODELS}
    n_scored = 0
    for snap in matches.values():
        sc = snap.get("score")
        if not sc:
            continue
        n_scored += 1
        for k, v in sc.items():
            a = agg[k]
            a["correct"] += v["correct"]; a["total"] += 1
            a["brier"] += v["brier"]; a["logloss"] += v["logloss"]
    summary = {"matches_scored": n_scored}
    for k, a in agg.items():
        if a["total"]:
            summary[k] = {
                "correct": a["correct"], "total": a["total"], "measured": True,
                "brier": round(a["brier"] / a["total"], 4),
                "logloss": round(a["logloss"] / a["total"], 4),
            }
    return summary


# ---- main -------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lead-hours", type=float, default=CAPTURE_LEAD_HRS)
    ap.add_argument("--now", default=None, help="ISO override for testing")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--inject-result", default=None, help="mid:score_a:score_b — synthetic result for scoring test")
    args = ap.parse_args()

    now_ts = parse_iso(args.now) if args.now else int(datetime.now(timezone.utc).timestamp())
    now_iso = datetime.fromtimestamp(now_ts, timezone.utc).isoformat(timespec="seconds")

    live_path = bh.dpath("live-backtest.json")
    live = json.load(open(live_path)) if os.path.exists(live_path) else {"matches": {}}
    matches = live.setdefault("matches", {})

    schedule = bh.load("schedule_full.json")
    actual = bh.load("actual_results.json")
    if args.inject_result:
        mid, sa, sb = args.inject_result.split(":")
        actual.setdefault("group_stage", {})[mid] = {"score_a": int(sa), "score_b": int(sb), "status": "STATUS_FULL_TIME"}

    sig = build_signals()
    pm_idx = polymarket_index()
    log(f"now={now_iso}  lead={args.lead_hours}h  polymarket matches indexed={len(pm_idx)}")

    captured = scored = skipped_names = 0
    for m in schedule:
        mid = m.get("match_id"); a = m.get("team_a"); b = m.get("team_b")
        ko = parse_iso(m.get("kickoff_utc"))
        if not mid or not a or not b or ko is None:
            continue
        snap = matches.get(mid)

        # CAPTURE / REFRESH while pre-kickoff and within the lead window
        if now_ts < ko and (ko - now_ts) <= args.lead_hours * 3600:
            preds = model_preds(a, b, sig)
            if preds is None:
                skipped_names += 1
            else:
                pm = pm_preds(a, b, pm_idx)
                if pm:
                    preds["polymarket"] = pm
                matches[mid] = {
                    "match_number": m.get("match_number"), "stage": m.get("stage"),
                    "team_a": a, "team_b": b, "kickoff_utc": m.get("kickoff_utc"),
                    "captured_at": now_iso,
                    "preds": {k: [round(x, 4) for x in v] for k, v in preds.items()},
                    "actual": (snap or {}).get("actual"),
                    "score": (snap or {}).get("score"),
                    "scored": (snap or {}).get("scored", False),
                }
                captured += 1
            snap = matches.get(mid)

        # SCORE once a final result exists
        if snap and not snap.get("scored"):
            rec = find_result(actual, mid)
            if rec:
                oi = outcome_index(rec)
                snap["actual"] = ["team_a_wins", "draw", "team_b_wins"][oi]
                snap["actual_score"] = f"{rec['score_a']}-{rec['score_b']}"
                snap["score"] = score_preds(snap["preds"], oi)
                snap["scored"] = True
                scored += 1

    summary = summarize(matches)
    live["updated_at"] = now_iso
    live["summary"] = summary

    if not args.dry_run:
        json.dump(live, open(live_path, "w"), indent=2)
        bt_path = bh.dpath("backtest.json")
        bt = json.load(open(bt_path))
        note = (f"{summary['matches_scored']} matches scored live. Pre-kickoff predictions locked from all "
                f"models + markets, scored on the regulation result." if summary["matches_scored"]
                else "Awaiting first results (kickoff 11 June). Snapshots locked pre-kickoff.")
        bt["live2026"] = {"generated_at": now_iso, "note": note,
                          **{k: v for k, v in summary.items()}}
        json.dump(bt, open(bt_path, "w"), indent=2)

    log(f"captured/refreshed={captured}  scored={scored}  name-skips={skipped_names}  total snapshots={len(matches)}")
    if summary["matches_scored"]:
        print("\nLIVE WC2026 BACKTEST (measured)")
        for k in MODELS:
            if k in summary:
                s = summary[k]
                print(f"  {k:11} {s['correct']}/{s['total']} = {s['correct']/s['total']*100:5.1f}%  "
                      f"Brier {s['brier']:.4f}  log-loss {s['logloss']:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
