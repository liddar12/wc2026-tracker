"""Update Transfermarkt squad market values.

Transfermarkt is aggressive about blocking scrapers. We therefore:
  * Only run weekly (workflow gate), not daily.
  * Try Wikipedia first (Squad Market Value tables sometimes mirror TMV).
  * If TMV blocks us (403/captcha), exit 0 without modifying data.
"""
from __future__ import annotations

import re
import sys

from _common import ScrapeError, load_json, log, polite_get, save_json, update_meta

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_FIFA_country_codes"  # placeholder — TMV pages vary
TMV_URL = "https://www.transfermarkt.com/wettbewerbe/fifaWeltrang"


def fetch_tmv() -> dict[str, float]:
    try:
        res = polite_get(TMV_URL)
    except ScrapeError as e:
        log(f"tmv: {e}")
        return {}
    text = res.text
    if "captcha" in text.lower() or len(text) < 5000:
        log("tmv: looks blocked/captcha; skipping")
        return {}
    # Best-effort: parse rows of "Country" + market value
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(text, "lxml")
    out: dict[str, float] = {}
    for row in soup.select("table.items tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 5:
            continue
        name = cells[1].get_text(strip=True)
        val = cells[-1].get_text(strip=True)
        m = re.search(r"([\d,.]+)\s*([mb])", val.lower())
        if not m:
            continue
        num = float(m.group(1).replace(",", ""))
        if m.group(2) == "b":
            num *= 1000
        out[name] = num
    return out


def main() -> int:
    try:
        tmv = fetch_tmv()
    except ScrapeError as e:
        log(f"tmv: {e}; skipping")
        return 0
    if not tmv:
        log("tmv: no data; leaving values untouched")
        return 0
    teams = load_json("teams.json")
    aliases = {"USA": "United States", "Korea Republic": "South Korea"}
    changed = 0
    for name, team in teams.items():
        v = tmv.get(aliases.get(name, name)) or tmv.get(name)
        if v and abs(v - team.get("tmv_musd", 0)) > 0.5:
            team["tmv_musd"] = round(v, 1)
            changed += 1
    if changed:
        save_json("teams.json", teams)
        update_meta()
        log(f"tmv: {changed} teams updated")
    else:
        log("tmv: no changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
