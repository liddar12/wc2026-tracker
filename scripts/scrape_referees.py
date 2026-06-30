#!/usr/bin/env python3
"""Daily-refresh hook for referees + match assignments.

Sources (probed in order, first that yields parseable data wins):
  1. FIFA referee profiles JSON feed
  2. Wikipedia "List of FIFA World Cup 2026 referees" article

Both can 4xx; if every probe fails, leave data/referees.json and
data/match_referees.json untouched and exit 0.

This is intentionally conservative — we never delete an existing entry.

Output files:
  data/referees.json — directory keyed by ref_id, see the README for shape
  data/match_referees.json — { match_id: ref_id } for announced assignments

Safe under continue-on-error.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import polite_get, ScrapeError, log, DATA_DIR  # type: ignore


WIKI_PAGE = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_officials"


def load(name: str):
    p = DATA_DIR / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save(name: str, data) -> None:
    # Atomic + ASCII (repo on-disk convention; staleness watchdog compares diffs).
    path = DATA_DIR / name
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )
    tmp.replace(path)


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or "ref"


def try_wikipedia(existing_refs: dict) -> int:
    """Parse the Wikipedia officials list. Returns count of new/updated rows."""
    try:
        res = polite_get(WIKI_PAGE)
    except ScrapeError as e:
        log(f"refs: wikipedia: {e}")
        return 0

    # Match table rows of the form:
    #   <tr><td>Name</td><td>Confederation</td><td>Nationality</td>...</tr>
    rows = re.findall(
        r"<tr>\s*<td[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>"
        r"\s*<td[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>"
        r"\s*<td[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>",
        res.text,
    )
    n = 0
    for name, confed, country in rows[:200]:
        name = name.strip()
        if not name or " " not in name:
            continue
        rid = slugify(name)
        cur = existing_refs.get(rid) or {}
        cur.setdefault("ref_id", rid)
        cur["name"] = name
        cur["confederation"] = (cur.get("confederation") or confed.strip())[:8]
        cur["nationality"] = cur.get("nationality") or country.strip()
        cur.setdefault("stats", {})
        cur.setdefault("history", [])
        existing_refs[rid] = cur
        n += 1
    return n


def main() -> int:
    refs = load("referees.json")
    mrefs = load("match_referees.json")
    if not isinstance(refs, dict):
        refs = {}
    if not isinstance(mrefs, dict):
        mrefs = {}

    # Snapshot the ref + assignment data (excluding __meta__) so we only bump
    # updated_at when something actually changed — a no-op bump would make
    # referees.json look perpetually fresh and defeat the staleness watchdog.
    before_refs = {k: v for k, v in refs.items() if k != "__meta__"}
    before_mrefs = dict(mrefs)

    n = try_wikipedia(refs)
    if n:
        log(f"refs: refreshed {n} entries from Wikipedia")

    after_refs = {k: v for k, v in refs.items() if k != "__meta__"}
    if after_refs == before_refs and mrefs == before_mrefs:
        log("refs: no data change; leaving updated_at untouched")
        return 0

    refs.setdefault("__meta__", {})
    refs["__meta__"]["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    save("referees.json", refs)
    save("match_referees.json", mrefs)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"refs: fatal — {e}; continuing")
        raise SystemExit(0)
