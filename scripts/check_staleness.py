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

WATCH = ["data/teams.json", "data/players.json"]
THRESHOLD_HOURS = 36
TOURNAMENT_START = "2026-06-11"
TOURNAMENT_END = "2026-07-20"
LABEL = "stale-data"


def log(m): print(f"[staleness] {m}", file=sys.stderr, flush=True)


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
            stale.append((path, round(age, 1)))
            log(f"STALE: {path} unchanged {age:.1f}h (> {THRESHOLD_HOURS}h)")
        elif age is not None:
            log(f"ok: {path} {age:.1f}h")
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

    body = ("Model inputs have not updated within "
            f"{THRESHOLD_HOURS}h during the tournament — predictions may be stale:\n\n"
            + "\n".join(f"- `{p}` — {h}h stale" for p, h in stale)
            + "\n\nLikely a dead rating source. See docs/POSTMORTEM_2026-06-19.md.")
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
