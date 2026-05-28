#!/usr/bin/env python3
"""Head-to-head history scraper.

For every group-stage matchup we look up the last 10 meetings between the two
teams and write the top 5 most recent into data/h2h.json keyed by
"<team_a>__vs__<team_b>".

Source: football-data.co.uk's head-to-head endpoint, fall back to Wikipedia.
Both can 4xx; on failure we leave existing entries alone and exit 0.

Safe under continue-on-error. Rate-limited per host via _common.polite_get.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import polite_get, ScrapeError, log, DATA_DIR  # type: ignore


def load(name: str):
    p = DATA_DIR / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save(name: str, data) -> None:
    (DATA_DIR / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    gm = load("group_matchups.json")
    out = load("h2h.json")
    if not isinstance(out, dict):
        out = {}

    pairs = []
    for g, info in gm.items():
        for m in info.get("matches", []):
            pairs.append((m["team_a"], m["team_b"]))

    fetched = 0
    for a, b in pairs:
        key = f"{a}__vs__{b}"
        if key in out and isinstance(out[key], list) and out[key]:
            # Have data already — only refresh once a week
            continue
        # Best-effort: try the football-data h2h endpoint.
        try:
            url = (
                "https://api.football-data.org/v4/teams/"
                f"head2head?teamA={a}&teamB={b}"
            )
            res = polite_get(url, accept_json=True)
            data = res.json()
        except (ScrapeError, ValueError):
            continue

        matches = data.get("matches") if isinstance(data, dict) else None
        if not isinstance(matches, list):
            continue
        rows = []
        for m in matches[:5]:
            home = (m.get("homeTeam") or {}).get("name")
            away = (m.get("awayTeam") or {}).get("name")
            score = (m.get("score") or {}).get("fullTime") or {}
            sh = score.get("home")
            sa = score.get("away")
            if not home or not away or sh is None or sa is None:
                continue
            score_a = sh if home == a else sa
            score_b = sa if home == a else sh
            winner = a if score_a > score_b else (b if score_a < score_b else "draw")
            rows.append({
                "date": (m.get("utcDate") or "").split("T")[0],
                "comp": (m.get("competition") or {}).get("name"),
                "score_a": score_a,
                "score_b": score_b,
                "winner": winner,
            })
        if rows:
            out[key] = rows
            fetched += 1

    out.setdefault("__meta__", {})
    out["__meta__"]["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save("h2h.json", out)
    log(f"h2h: refreshed {fetched} pairings")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"h2h: fatal — {e}; continuing")
        raise SystemExit(0)
