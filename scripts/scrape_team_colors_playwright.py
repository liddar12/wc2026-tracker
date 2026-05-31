#!/usr/bin/env python3
"""Optional Playwright cross-check for data/team_colors.json.

Hits the team's Wikipedia article, renders it, and extracts colors from the
visible infobox kit SVG (which is the literal rendered color rather than the
template field value). Useful when the Wikipedia template parsing is wrong
(e.g. team uses a template that resolves a color elsewhere).

This is NOT in the cron — it adds ~300MB Playwright + Chromium binaries to
the runner and runs slowly. Use locally to verify your team_colors.json:

    pip install playwright
    playwright install chromium --with-deps
    python3 scripts/scrape_team_colors_playwright.py

The output is a diagnostic file data/team_colors_playwright.json showing the
rendered shirt color for each team. Compare against data/team_colors.json
manually; update data/team_colors_overrides.json where divergent.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEAMS_JSON = ROOT / "data" / "teams.json"
OUT_JSON = ROOT / "data" / "team_colors_playwright.json"

# Reuse the title map from the Wikipedia scraper
from scrape_team_colors_wiki import wiki_title_for, WIKI_TITLES

def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed. Run: pip install playwright && playwright install chromium")
        return 1

    teams = json.loads(TEAMS_JSON.read_text())
    names = list(teams.keys()) if isinstance(teams, dict) else [x["name"] for x in teams]

    out = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent="wc26-tracker/1.0 (+https://worldcup2026.j5lagenticstrategy.com)")
        page = ctx.new_page()
        for i, team in enumerate(names, 1):
            title = wiki_title_for(team).replace(" ", "_")
            url = f"https://en.wikipedia.org/wiki/{title}"
            try:
                page.goto(url, timeout=15000, wait_until="domcontentloaded")
                # Pull rendered fill colors from the first kit SVG (home kit).
                colors = page.eval_on_selector_all(
                    "div.infobox-image svg path, div.infobox-image svg rect",
                    "els => els.map(el => el.getAttribute('fill')).filter(Boolean)"
                )
                # Reduce to a unique set, ordered by first appearance
                seen = []
                for c in colors:
                    if c and c not in seen and c.startswith("#"):
                        seen.append(c.upper())
                out[team] = {"render_fills": seen[:5], "url": url}
                print(f"  [{i:2d}/{len(names)}] {team:<28} {seen[:3]}")
            except Exception as e:
                out[team] = {"render_fills": [], "url": url, "error": str(e)[:80]}
                print(f"  [{i:2d}/{len(names)}] {team:<28} ERR ({e})")
        browser.close()

    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"\nwrote {len(out)} entries to {OUT_JSON}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
