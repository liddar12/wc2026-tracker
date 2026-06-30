#!/usr/bin/env python3
"""P0-A2 staleness watchdog — alert if model inputs stop moving mid-tournament.

Why: the team-strength inputs (teams.json composite/elo, players.json) silently
froze from 2026-05-28 through the whole group stage because their scrapers fail
under continue-on-error with no alert. This watchdog makes that loud.

For each watched file it asks the GitHub API for the last commit that touched it
(API, not `git log` — CI checkouts are shallow and lack file history), computes
age, and during the tournament window opens ONE labeled `stale-data` issue if any
input exceeds the threshold. Dedupes against an existing open issue. Never fails
the job (always exits 0) so it can't mask or block the data refresh.

Env: GITHUB_TOKEN (or GH_TOKEN), GITHUB_REPOSITORY (owner/repo). Without a token
it just prints and exits 0 (safe locally).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Commit-age watch: model-strength inputs that SHOULD move during the
# tournament. players.json is intentionally NOT here — rosters are locked once
# the tournament starts (frozen since 2026-05-27 is expected, not a fault), so
# age-alarming it produced a permanent false positive. Its emptiness is still
# guarded below.
WATCH = ["data/teams.json"]

# Emptiness watch: volatile, fan-facing feeds whose scrapers fail silently under
# continue-on-error. An EMPTY feed mid-tournament is the real failure mode (the
# file's commit timestamp can look fresh while its payload is {}), so we read
# the local file and alarm on emptiness regardless of commit age.
EMPTY_WATCH = [
    "data/teams.json",
    "data/players.json",
    "data/scorers.json",
    "data/markets.json",
    "data/form.json",
]
THRESHOLD_HOURS = 36
TOURNAMENT_START = "2026-06-11"
TOURNAMENT_END = "2026-07-20"
LABEL = "stale-data"

ROOT = Path(__file__).resolve().parent.parent


def log(m): print(f"[staleness] {m}", file=sys.stderr, flush=True)


def _payload_count(name: str, obj) -> int:
    """Count the substantive rows in a data file, ignoring __meta__ wrappers.

    Returns the number of real entries so 0 == empty feed (the failure mode).
    markets.json keys off its tournament_winner list; dict/list feeds count
    their non-__meta__ entries."""
    if name.endswith("markets.json") and isinstance(obj, dict):
        return len(obj.get("tournament_winner") or [])
    if isinstance(obj, dict):
        return len([k for k in obj if k != "__meta__"])
    if isinstance(obj, list):
        return len(obj)
    return 0


def empty_feeds(now):
    """Local-file emptiness scan. Returns [(path, reason), ...] for empty feeds
    during the tournament window. Needs no GitHub token (runs anywhere)."""
    out = []
    for rel in EMPTY_WATCH:
        p = ROOT / rel
        if not p.exists():
            out.append((rel, "missing"))
            continue
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            out.append((rel, f"unreadable ({e})"))
            continue
        if _payload_count(rel, obj) == 0:
            out.append((rel, "empty payload"))
    return out


def api(url, token, method="GET", body=None):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "wc26-staleness"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, headers=headers, data=data, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def last_commit_age_hours(repo, path, token, now):
    try:
        rows = api(f"https://api.github.com/repos/{repo}/commits?path={path}&per_page=1", token)
        when = rows[0]["commit"]["committer"]["date"]  # ISO Z
        dt = datetime.fromisoformat(when.replace("Z", "+00:00"))
        return (now - dt).total_seconds() / 3600.0
    except Exception as e:  # noqa: BLE001
        log(f"age lookup failed for {path}: {e}")
        return None


def main():
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    if not (TOURNAMENT_START <= today <= TOURNAMENT_END):
        log(f"outside tournament window ({today}); skipping")
        return 0
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY", "liddar12/wc2026-tracker")

    stale = []
    for path in WATCH:
        age = last_commit_age_hours(repo, path, token, now)
        if age is not None and age > THRESHOLD_HOURS:
            stale.append((path, f"{round(age, 1)}h stale"))
            log(f"STALE: {path} unchanged {age:.1f}h (> {THRESHOLD_HOURS}h)")
        elif age is not None:
            log(f"ok: {path} {age:.1f}h")

    # Emptiness is the real failure mode (a silently-failing scraper leaves a
    # fresh-timestamped but EMPTY feed) — flag it even when the commit looks new.
    for path, reason in empty_feeds(now):
        stale.append((path, reason))
        log(f"EMPTY: {path} — {reason}")

    if not stale:
        log("all watched inputs fresh")
        return 0
    if not token:
        log("stale inputs found but no token; not opening an issue")
        return 0

    # Dedupe: skip if an open stale-data issue already exists.
    try:
        existing = api(f"https://api.github.com/repos/{repo}/issues?labels={LABEL}&state=open&per_page=1", token)
        if existing:
            log(f"open {LABEL} issue already exists (#{existing[0]['number']}); not duplicating")
            return 0
    except Exception as e:  # noqa: BLE001
        log(f"dedupe check failed: {e}")

    body = ("Model inputs are stale or empty during the tournament — predictions "
            "may be frozen / fan-facing feeds blank:\n\n"
            + "\n".join(f"- `{p}` — {reason}" for p, reason in stale)
            + "\n\nLikely a dead rating source or a silently-failing scraper. "
            "See docs/POSTMORTEM_2026-06-19.md.")
    try:
        api(f"https://api.github.com/repos/{repo}/issues", token, method="POST",
            body={"title": "🟠 Model inputs stale (analytics not moving)", "body": body, "labels": [LABEL, "pipeline-alert"]})
        log(f"opened {LABEL} alert for {len(stale)} input(s)")
    except Exception as e:  # noqa: BLE001
        log(f"failed to open issue: {e}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log(f"fatal — {e}")
        raise SystemExit(0)
