#!/usr/bin/env python3
"""Results-derived recent form → data/form.json (RJ30-8).

Replaces the flaky ESPN `scrape_form.py`. Derives each team's last-5 W/D/L from
the tournament's own record (data/actual_results.json) — pure code, no network.

Output (the shape app/components/form.js and compute_xg.form_points() already
expect):
  data/form.json
    { "Team Name": [ { date, opponent, score_a, score_b, result }, ... ] }
  most-recent first, capped at 5, score_a/score_b oriented to the team.

Result derivation handles shootouts: a knockout decided on penalties
(STATUS_FINAL_PEN) or extra time (STATUS_FINAL_AET) carries a `winner` — the
winner gets W and the loser L (never D), while the displayed score_a/score_b are
the REGULATION scores (so the tooltip reads e.g. 1–1 with a W/L pill).

Shares the FINAL gate with compute_form.py (which writes the SEPARATE
teams.json.form_scaled signal); neither writes the other's file.

Self-test (no network): python3 scripts/compute_form_recent.py --selftest

Idempotent. Exits 0 on any error, leaving form.json untouched.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Recent form counts ANY decided game — including knockout ties settled by extra
# time / penalties (those carry a `winner`). This is a SUPERSET of
# compute_form.py's FINAL set (which feeds the leak-sensitive form_scaled and
# deliberately excludes AET/PEN); the two signals share the regulation-FINAL
# core but serve different consumers.
FINAL = {
    "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_OF_FULL_TIME",
    "STATUS_FINAL_AET", "STATUS_FINAL_PEN",
}
KO_TIERS = ("round_of_32", "round_of_16", "quarterfinals", "semifinals", "third_place", "final")
TIERS = ("group_stage",) + KO_TIERS


def log(m):
    print(f"[form-recent] {m}", file=sys.stderr, flush=True)


def load(name: str):
    p = DATA / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save(name: str, data) -> None:
    # Atomic + ASCII (repo on-disk convention; staleness watchdog compares diffs).
    path = DATA / name
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )
    tmp.replace(path)


def result_for(side: str, winner, score_for: int, score_against: int) -> str:
    """W/D/L for `side`. A shootout/AET tie carries `winner` → W/L (never D);
    otherwise compare regulation scores."""
    if winner:
        return "W" if winner == side else "L"
    if score_for > score_against:
        return "W"
    if score_for < score_against:
        return "L"
    return "D"


def compute(results) -> dict[str, list]:
    """{ team: [ {date, opponent, score_a, score_b, result}, ... ] } last-5, desc."""
    events: dict[str, list] = {}
    for tier in TIERS:
        block = results.get(tier) or {}
        if not isinstance(block, dict):
            continue
        for key, rec in block.items():
            if not isinstance(rec, dict) or "__vs__" not in key:
                continue
            st = rec.get("status")
            if st and st not in FINAL:
                continue
            sa, sb = rec.get("score_a"), rec.get("score_b")
            if not isinstance(sa, (int, float)) or not isinstance(sb, (int, float)):
                continue
            a, b = key.split("__vs__", 1)
            winner = rec.get("winner")
            date = (rec.get("kickoff_utc") or "").split("T")[0]
            # Team-as-A keeps (score_a, score_b); team-as-B swaps the orientation.
            events.setdefault(a, []).append({
                "date": date,
                "opponent": b,
                "score_a": sa,
                "score_b": sb,
                "result": result_for(a, winner, sa, sb),
            })
            events.setdefault(b, []).append({
                "date": date,
                "opponent": a,
                "score_a": sb,
                "score_b": sa,
                "result": result_for(b, winner, sb, sa),
            })
    out: dict[str, list] = {}
    for team, rows in events.items():
        rows.sort(key=lambda r: r["date"], reverse=True)
        out[team] = rows[:5]
    return out


def main() -> int:
    results = load("actual_results.json")
    out = load("form.json")
    if not isinstance(out, dict):
        out = {}

    before = {k: v for k, v in out.items() if k != "__meta__"}
    new_rows = compute(results)

    # Replace the team rows wholesale (rebuilt every run), preserve __meta__.
    rebuilt = dict(new_rows)
    after = {k: v for k, v in rebuilt.items()}

    if after == before:
        log("form: no data change; leaving updated_at untouched")
        return 0

    meta = out.get("__meta__", {}) if isinstance(out.get("__meta__"), dict) else {}
    meta["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rebuilt["__meta__"] = meta
    save("form.json", rebuilt)
    log(f"form: rebuilt {len(new_rows)} teams from actual_results")
    return 0


def selftest() -> int:
    fail = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fail
        print(f"  {'ok  ' if cond else 'FAIL'}: {name}")
        if not cond:
            fail += 1

    results = {
        "group_stage": {
            "Mexico__vs__South Africa": {
                "score_a": 2, "score_b": 0,
                "kickoff_utc": "2026-06-11T19:00Z", "status": "STATUS_FULL_TIME",
            },
            "Mexico__vs__Uruguay": {  # a regulation draw → D for both
                "score_a": 1, "score_b": 1,
                "kickoff_utc": "2026-06-15T19:00Z", "status": "STATUS_FULL_TIME",
            },
            # A team that has played only one game (no padding).
            "Iran__vs__Qatar": {
                "score_a": 0, "score_b": 1,
                "kickoff_utc": "2026-06-12T16:00Z", "status": "STATUS_FULL_TIME",
            },
            # SCHEDULED record must be excluded.
            "Brazil__vs__Morocco": {
                "score_a": 0, "score_b": 0,
                "kickoff_utc": "2026-06-20T16:00Z", "status": "STATUS_SCHEDULED",
            },
        },
        "round_of_32": {
            # Penalty shootout: regulation 1–1, winner Paraguay.
            "Germany__vs__Paraguay": {
                "score_a": 1, "score_b": 1,
                "kickoff_utc": "2026-06-29T20:30Z", "status": "STATUS_FINAL_PEN",
                "winner": "Paraguay", "shootout_a": 3, "shootout_b": 4,
            },
        },
    }
    form = compute(results)

    check("pen winner gets W (not D)",
          form["Paraguay"][0]["result"] == "W")
    check("pen loser gets L (not D)",
          form["Germany"][0]["result"] == "L")
    check("pen game shows regulation score for winner (oriented)",
          form["Paraguay"][0]["score_a"] == 1 and form["Paraguay"][0]["score_b"] == 1)
    check("pen winner opponent is the other side",
          form["Paraguay"][0]["opponent"] == "Germany")

    check("regulation win → W",
          any(e["opponent"] == "South Africa" and e["result"] == "W" for e in form["Mexico"]))
    check("orientation: team-as-A keeps score, opponent mirror swaps",
          form["South Africa"][0]["score_a"] == 0 and form["South Africa"][0]["score_b"] == 2
          and form["South Africa"][0]["result"] == "L")
    check("regulation draw → D for both",
          any(e["opponent"] == "Uruguay" and e["result"] == "D" for e in form["Mexico"])
          and form["Uruguay"][0]["result"] == "D")

    check("most-recent first (Paraguay R32 before any group game)",
          form["Paraguay"][0]["date"] == "2026-06-29")
    check("Mexico sorted desc (2026-06-15 before 2026-06-11)",
          form["Mexico"][0]["date"] >= form["Mexico"][-1]["date"])

    check("<5 games → exactly that many entries, no padding",
          len(form["Qatar"]) == 1)
    check("SCHEDULED game excluded (Morocco never appears)",
          "Morocco" not in form)

    # cap at 5
    many = {"group_stage": {}}
    for i in range(7):
        many["group_stage"][f"TeamX__vs__Opp{i}"] = {
            "score_a": 1, "score_b": 0,
            "kickoff_utc": f"2026-06-{10+i:02d}T19:00Z", "status": "STATUS_FULL_TIME",
        }
    capped = compute(many)
    check("capped at 5 entries", len(capped["TeamX"]) == 5)
    check("cap keeps the 5 most recent", capped["TeamX"][0]["date"] == "2026-06-16")

    print(f"selftest: {'PASS' if not fail else f'{fail} FAILURE(S)'}")
    return 1 if fail else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest())
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}; leaving form.json untouched")
        raise SystemExit(0)
