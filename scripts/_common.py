"""Shared helpers for WC26 Tracker scrapers.

Conventions enforced here:
- One request per 5 seconds per host (token-bucket via a simple sleep).
- Identifying User-Agent.
- robots.txt check per host (cached).
- Idempotent JSON writes that preserve key order.
- Failures log to stderr and re-raise as ScrapeError so the workflow can
  decide whether to fail the build (we choose to skip silently in the
  Action wrappers).
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.robotparser
from pathlib import Path
from typing import Any

import requests

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USER_AGENT = "wc26-tracker/1.0 (personal-project)"
MIN_INTERVAL = 5.0  # seconds between requests to the same host

_last_request: dict[str, float] = {}
_robots: dict[str, urllib.robotparser.RobotFileParser] = {}

# Hosts that are explicitly public, free, programmatic-use APIs. Their robots.txt
# is written for web CRAWLERS (e.g. api.open-meteo.com serves "Disallow: /"),
# which would block our single, rate-limited, documented API call — even though
# the service's whole purpose is to be hit by code. robots.txt governs crawling,
# not sanctioned API consumption, so we skip the robots check for these hosts
# only. We still honor the 5s/host rate limit + identifying User-Agent.
_ROBOTS_ALLOWLIST: frozenset[str] = frozenset({
    "api.open-meteo.com",  # free weather API; robots.txt is Disallow:/ for crawlers
})


class ScrapeError(Exception):
    pass


def log(msg: str) -> None:
    print(f"[wc26] {msg}", file=sys.stderr, flush=True)


def _host(url: str) -> str:
    return urllib.parse.urlparse(url).netloc.lower()


def _robots_ok(url: str) -> bool:
    host = _host(url)
    # Allowlisted public APIs (intended programmatic use) bypass the robots
    # check — their Disallow:/ targets crawlers, not sanctioned API calls. This
    # is what lets scrape_weather.py reach api.open-meteo.com in CI (its
    # robots.txt is Disallow:/, which previously refused the fetch).
    if host in _ROBOTS_ALLOWLIST:
        return True
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"https://{host}/robots.txt")
        try:
            rp.read()
        except Exception:
            # If we can't fetch robots.txt, default-allow but log.
            log(f"robots.txt unreachable for {host}; default-allowing")
            return True
        _robots[host] = rp
    return _robots[host].can_fetch(USER_AGENT, url)


def polite_get(url: str, *, timeout: float = 20.0, accept_json: bool = False) -> requests.Response:
    """GET that respects robots, rate-limits per host, sets UA, and raises on >=400."""
    if not _robots_ok(url):
        raise ScrapeError(f"robots.txt disallows {url}")
    host = _host(url)
    last = _last_request.get(host, 0.0)
    sleep_for = MIN_INTERVAL - (time.monotonic() - last)
    if sleep_for > 0:
        time.sleep(sleep_for)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json" if accept_json else "text/html,application/xhtml+xml,*/*",
    }
    log(f"GET {url}")
    res = requests.get(url, headers=headers, timeout=timeout)
    _last_request[host] = time.monotonic()
    if res.status_code >= 400:
        raise ScrapeError(f"HTTP {res.status_code} for {url}")
    return res


def load_json(name: str) -> Any:
    path = DATA_DIR / name
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(name: str, data: Any) -> None:
    """Atomically write JSON (tmp + os.replace), preserving dict order from data.

    ensure_ascii=True matches the on-disk encoding of every data/*.json file
    (the repo convention) — non-ASCII team/player names are stored as \\uXXXX
    escapes, so a co-writer using ensure_ascii=False would churn the diff and
    fight the other writers of the same file. The tmp+replace swap means a crash
    mid-write never leaves a truncated/half-written JSON behind.
    """
    path = DATA_DIR / name
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=True, indent=2)
        f.write("\n")
    tmp.replace(path)
    log(f"wrote {name}")


def update_meta(**changes: Any) -> None:
    meta = load_json("meta.json")
    meta.update(changes)
    from datetime import datetime, timezone
    meta["data_version"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save_json("meta.json", meta)
