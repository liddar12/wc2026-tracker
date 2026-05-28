"""Pull ESPN soccer power rankings.

ESPN does not publish a single SPI feed for all national teams, but the
public scoreboard JSON includes a power-index field per team in some
endpoints. We use the FIFA-rankings article page as a fallback. If the
parse fails, the script exits 0 without touching data.
"""
from __future__ import annotations

import sys

from _common import ScrapeError, load_json, log, polite_get, save_json, update_meta

URL = "https://www.espn.com/soccer/fifarank"


def fetch_ranks() -> dict[str, int]:
    try:
        res = polite_get(URL)
    except ScrapeError as e:
        log(f"espn: {e}")
        return {}
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(res.text, "lxml")
    out: dict[str, int] = {}
    for row in soup.select("table tbody tr"):
        cells = [c.get_text(strip=True) for c in row.find_all("td")]
        if len(cells) < 2:
            continue
        try:
            rank = int(cells[0])
        except ValueError:
            continue
        name = cells[1]
        out[name] = rank
    return out


def main() -> int:
    try:
        ranks = fetch_ranks()
    except ScrapeError as e:
        log(f"espn: {e}; skipping")
        return 0
    if not ranks:
        log("espn: no rankings parsed; skipping")
        return 0
    teams = load_json("teams.json")
    changed = 0
    aliases = {"USA": "United States", "Korea Republic": "South Korea"}
    for name, team in teams.items():
        site_name = aliases.get(name, name)
        r = ranks.get(site_name) or ranks.get(name)
        if r and r != team.get("espn_rank"):
            team["espn_rank"] = r
            changed += 1
    if changed:
        save_json("teams.json", teams)
        update_meta()
        log(f"espn: {changed} teams updated")
    else:
        log("espn: no changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
