#!/usr/bin/env python3
"""P0-A1 — results-driven Elo that actually feeds the predictions.

The team-strength model froze pre-tournament because Elo came only from a dead
scraper and nothing recomputed it from results (docs/POSTMORTEM_2026-06-19.md).
This computes Elo from the games actually played and writes it into the model
inputs so composite -> DT -> hybrid -> forecast move game-to-game.

Design:
- `elo_raw` in teams.json stays the IMMUTABLE pre-tournament seed (the client
  movers card, app/live-elo.js, also seeds from it — never overwrite it or the
  client would double-count).
- Replay every FINAL match from actual_results.json (all tiers, chronological)
  with the same math as live-elo.js (K_GROUP=30, K_KO=40, host bonus 100,
  margin multiplier, penalty-winner credit), producing `elo_current`.
- Map elo_current -> sub_ratings.elo_scaled via the linear transform recovered
  ONCE from the pristine pre-tournament (elo_raw, elo_scaled) pairs and frozen
  in data/elo_scale.json. rebuild_composite then flows it into composite.
- Idempotent: deterministic function of the seed + FINAL results.

Run BEFORE rebuild_composite. Status-gated (only FINAL counts). Exits 0 on any
error, leaving teams.json untouched.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TEAMS = DATA / "teams.json"
RESULTS = DATA / "actual_results.json"
SCALE = DATA / "elo_scale.json"

K_GROUP, K_KO, HOME_BONUS = 30, 40, 100
HOSTS = {"USA", "Mexico", "Canada"}
FINAL = {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME"}
KO_TIERS = ("round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final")


def log(m): print(f"[elo] {m}", file=sys.stderr, flush=True)


def is_final(rec):
    st = rec.get("status")
    return (st in FINAL) if st else True  # legacy records without status = treated final


def fit_scale(teams):
    """Recover elo_scaled = a*elo_raw + b from the pristine pairs (least squares)."""
    xs, ys = [], []
    for t in teams.values():
        er = t.get("elo_raw")
        es = (t.get("sub_ratings") or {}).get("elo_scaled")
        if isinstance(er, (int, float)) and isinstance(es, (int, float)):
            xs.append(float(er)); ys.append(float(es))
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n; my = sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return None
    a = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den
    b = my - a * mx
    # residual check — must be linear for this to be valid
    ss_res = sum((y - (a * x + b)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    r2 = 1 - ss_res / ss_tot if ss_tot else 1.0
    lo, hi = min(ys), max(ys)
    return {"a": a, "b": b, "clamp_lo": lo, "clamp_hi": hi, "r2": round(r2, 5)}


def load_scale(teams):
    if SCALE.exists():
        try:
            return json.loads(SCALE.read_text())
        except Exception:  # noqa: BLE001
            pass
    sc = fit_scale(teams)
    if sc:
        SCALE.write_text(json.dumps(sc, indent=2) + "\n")
        log(f"created elo_scale.json (R^2={sc['r2']})")
    return sc


def expected(ra, rb):
    return 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))


def apply_update(elo, a, b, rec, k):
    sa, sb = rec.get("score_a"), rec.get("score_b")
    if not isinstance(sa, (int, float)) or not isinstance(sb, (int, float)):
        return
    ra = (elo.get(a, 1500)) + (HOME_BONUS if a in HOSTS else 0)
    rb = (elo.get(b, 1500)) + (HOME_BONUS if b in HOSTS else 0)
    ea = expected(ra, rb); eb = 1 - ea
    if sa > sb:
        aa, ab = 1.0, 0.0
    elif sa < sb:
        aa, ab = 0.0, 1.0
    else:
        w = rec.get("winner") or rec.get("penalty_winner")
        if w == a:
            aa, ab = 0.75, 0.25
        elif w == b:
            aa, ab = 0.25, 0.75
        else:
            aa, ab = 0.5, 0.5
    gd = abs(sa - sb)
    margin = 1.0 if gd <= 1 else 1.5 if gd == 2 else (11 + gd) / 8.0
    if a in elo:
        elo[a] += k * margin * (aa - ea)
    if b in elo:
        elo[b] += k * margin * (ab - eb)


def main():
    teams = json.loads(TEAMS.read_text())
    results = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
    scale = load_scale(teams)
    if not scale:
        log("could not establish elo scale; leaving teams.json untouched")
        return 0

    elo = {name: float(t.get("elo_raw") or 1500) for name, t in teams.items()}

    # Collect FINAL matches across all tiers, chronological by kickoff.
    matches = []
    for tier, k in [("group_stage", K_GROUP)] + [(t, K_KO) for t in KO_TIERS]:
        for key, rec in (results.get(tier) or {}).items():
            if not isinstance(rec, dict) or not is_final(rec):
                continue
            if "__vs__" not in key:
                continue
            a, b = key.split("__vs__", 1)
            if a in elo and b in elo:
                matches.append((rec.get("kickoff_utc") or "", a, b, rec, k))
    matches.sort(key=lambda m: m[0])
    for _, a, b, rec, k in matches:
        apply_update(elo, a, b, rec, k)

    a_, b_ = scale["a"], scale["b"]
    lo, hi = scale["clamp_lo"], scale["clamp_hi"]
    changed = 0
    for name, t in teams.items():
        cur = round(elo[name])
        scaled = max(lo, min(hi, a_ * elo[name] + b_))
        scaled = round(scaled, 1)
        sub = t.setdefault("sub_ratings", {})
        if t.get("elo_current") != cur or sub.get("elo_scaled") != scaled:
            t["elo_current"] = cur
            sub["elo_scaled"] = scaled
            changed += 1
    TEAMS.write_text(json.dumps(teams, ensure_ascii=False, indent=2) + "\n")
    log(f"replayed {len(matches)} FINAL match(es); updated {changed} team(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving teams.json untouched")
        raise SystemExit(0)
