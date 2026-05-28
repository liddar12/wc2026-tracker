"""Pull current Elo ratings from eloratings.net and merge into teams.json.

Site has a structured HTML table at https://www.eloratings.net/. We grab
rankings for all 48 WC26 teams we know about; missing teams are skipped.

Safe to re-run. Failing source = log + exit 0 so the daily workflow keeps going.
"""
from __future__ import annotations

import sys

from bs4 import BeautifulSoup

from _common import ScrapeError, load_json, log, polite_get, save_json, update_meta

URL = "https://www.eloratings.net/"

# Map our team names to eloratings.net display names where they differ.
ALIAS = {
    "USA": "United States",
    "Korea Republic": "South Korea",
    "Türkiye": "Turkey",
    "Turkiye": "Turkey",
    "Cote d'Ivoire": "Côte d'Ivoire",
    "Czechia": "Czech Republic",
    "Republic of Ireland": "Ireland",
}


def fetch_elo_table() -> dict[str, int]:
    res = polite_get(URL)
    soup = BeautifulSoup(res.text, "lxml")
    elo: dict[str, int] = {}
    # The current site renders the table from JS; the JSON blob is embedded
    # in a <script> as `var ratingsData = [...]`. Parse defensively.
    for script in soup.find_all("script"):
        text = script.string or ""
        if "ratingsData" not in text:
            continue
        # Look for a simple "Team Name", number, pattern. This is best-effort —
        # if the page format shifts, scraper logs a warning and returns {}.
        # The actual schema varies; treat any failure as "no data".
        return _parse_ratings(text)
    return elo


def _parse_ratings(blob: str) -> dict[str, int]:
    import re
    out: dict[str, int] = {}
    # Patterns like ["Team Name", 1804, ...] — we accept the first int after the name.
    for m in re.finditer(r'\["([^"]{2,40})",\s*(\d{3,4})', blob):
        name, rating = m.group(1), int(m.group(2))
        out[name] = rating
    return out


def main() -> int:
    try:
        elo = fetch_elo_table()
    except ScrapeError as e:
        log(f"elo: {e}; skipping")
        return 0
    if not elo:
        log("elo: no data parsed; skipping")
        return 0

    teams = load_json("teams.json")
    changed = 0
    for name, team in teams.items():
        site_name = ALIAS.get(name, name)
        rating = elo.get(site_name) or elo.get(name)
        if rating and rating != team.get("elo_raw"):
            team["elo_raw"] = rating
            changed += 1
    if changed:
        save_json("teams.json", teams)
        update_meta()
        log(f"elo: {changed} teams updated")
    else:
        log("elo: no changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
