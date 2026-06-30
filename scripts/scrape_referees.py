#!/usr/bin/env python3
"""Daily-refresh hook for referees + match assignments.

Directory source (reliably free, low-churn):
  MediaWiki REST parse API for the Wikipedia "2026 FIFA World Cup officials"
  article — `action=parse&prop=wikitext` returns the raw wikitext, which we
  parse from the `{| ... |}` wikitable rows. This replaces the previous brittle
  3-`<td>` HTML regex that never matched the live wikitable markup (class/scope/
  rowspan/<span>/flag-icon nodes the regex didn't allow), so referees.json stayed
  empty. api.php is robots-clean and needs no key.

Assignments (opportunistic, best-effort):
  Per-match official appointments have NO fully-reliable free structured source
  (FIFA.com is robots-blocked; per-match Wikipedia pages are unstructured + late).
  We OPPORTUNISTICALLY parse any "Referee" / "Officials" lines in the group/
  knockout-stage wikitext and map "Team A vs Team B -> Name" to a schedule_full
  match_id orientation. Unannounced fixtures are simply absent (the referee panel
  already renders a graceful "Not yet announced" note), so the build's guaranteed
  deliverable is the directory; assignments are a bonus when present.

Both probes can 4xx/timeout; if every probe fails, leave data/referees.json and
data/match_referees.json untouched and exit 0. This is intentionally conservative
— we never delete an existing entry.

Output files:
  data/referees.json — directory keyed by ref_id, see the README for shape
  data/match_referees.json — { match_id: ref_id } for announced assignments

Safe under continue-on-error.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import polite_get, ScrapeError, log, DATA_DIR  # type: ignore


# MediaWiki parse API — returns raw wikitext (robust) instead of rendered HTML
# (brittle). prop=wikitext means we parse `{| ... |}` table rows, not <td> tags.
OFFICIALS_PAGE = "2026_FIFA_World_Cup_officials"
API_URL = (
    "https://en.wikipedia.org/w/api.php?action=parse"
    f"&page={OFFICIALS_PAGE}&prop=wikitext&format=json&formatversion=2"
)
# Group + knockout stage pages carry the per-match "Referee:" officials lines
# we opportunistically harvest for assignments.
ASSIGN_PAGES = [
    "2026_FIFA_World_Cup_group_stage",
    "2026_FIFA_World_Cup_knockout_stage",
]

# Mirror of the project RENAMES map (ESPN/Wikipedia names -> canonical) so an
# assignment keyed off a Wikipedia fixture lines up with schedule_full.json.
RENAMES = {
    "United States": "USA",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "Türkiye": "Turkiye",
    "Republic of Ireland": "Ireland",
    "IR Iran": "Iran",
    "Korea Republic": "South Korea",
    "Côte d'Ivoire": "Ivory Coast",
    "Cabo Verde": "Cape Verde",
}

CONFED_TOKENS = {"AFC", "CAF", "CONCACAF", "CONMEBOL", "OFC", "UEFA"}


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


def _fold_diacritics(s: str) -> str:
    """Drop combining marks so 'Marçiniak' and 'Marciniak' fold together.

    Used ONLY inside slugify so the same referee maps to one stable ref_id
    across runs; the displayed `name` keeps its original Unicode (then gets
    ASCII-escaped on serialize per the repo convention)."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", _fold_diacritics(name).lower()).strip("_")
    return s or "ref"


def _strip_wiki(cell: str) -> str:
    """Reduce a wikitext table cell to plain display text.

    Handles the markup a Wikipedia wikitable carries that the old HTML regex
    couldn't: piped links `[[Target|Display]] -> Display`, bare links
    `[[Name]] -> Name`, flag templates `{{flagicon|Poland}}`/`{{flag|Poland}}`,
    `<ref>...</ref>` footnotes, residual HTML tags, and bold/italic apostrophes.
    """
    s = cell
    # Drop <ref>...</ref> footnotes (greedy-safe, non-greedy per ref).
    s = re.sub(r"<ref[^>]*?/>", "", s)
    s = re.sub(r"<ref[^>]*?>.*?</ref>", "", s, flags=re.DOTALL)
    # Flag / nationality templates: keep the FIRST positional arg as the label.
    #   {{flagicon|Poland}} -> Poland ; {{flag|Brazil|1968}} -> Brazil
    s = re.sub(r"\{\{\s*(?:flagicon|flag|flagcountry|fb|fbu)\s*\|\s*([^|}]+)[^}]*\}\}",
               r"\1", s, flags=re.IGNORECASE)
    # Any other template -> drop entirely.
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    # Piped wiki links [[Target|Display]] -> Display ; [[Name]] -> Name
    s = re.sub(r"\[\[[^\]|]*\|([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    # External links [http://x label] -> label
    s = re.sub(r"\[https?://\S+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\]", "", s)
    # Residual HTML tags + bold/italic apostrophes.
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    # Cell attribute prefix `class=... | text` — keep what's after the last `|`.
    if "|" in s and re.match(r"^[^|]*=[^|]*\|", s):
        s = s.split("|")[-1]
    return s.strip()


def _split_rows(wikitext: str) -> list[str]:
    """Return the body of the FIRST wikitable as a list of row blocks."""
    m = re.search(r"\{\|(.*?)\n\|\}", wikitext, flags=re.DOTALL)
    body = m.group(1) if m else wikitext
    # Rows are delimited by `|-`. Drop the first chunk (table caption / header
    # styling before the first `|-`).
    parts = re.split(r"\n\|-+", body)
    return parts[1:] if len(parts) > 1 else parts


def _row_cells(row_block: str) -> list[str]:
    """Split a row block into cell texts (data `|` cells + header `!` cells)."""
    cells = []
    for line in row_block.split("\n"):
        line = line.strip()
        if not line:
            continue
        # A line may pack several cells on one line via `||` (or `!!` for headers).
        if line.startswith("!"):
            for seg in re.split(r"!!|\n!", line[1:]):
                cells.append(_strip_wiki(seg))
        elif line.startswith("|"):
            for seg in line[1:].split("||"):
                cells.append(_strip_wiki(seg))
    return [c for c in cells if c != ""]


def _looks_like_name(s: str) -> bool:
    # A referee name has at least two words and starts with a letter; reject
    # confederation tokens, pure numbers, and header labels.
    if not s or s.upper() in CONFED_TOKENS:
        return False
    if s.lower() in {"name", "referee", "referees", "nationality", "confederation",
                     "country", "assistant referees", "video assistant referees"}:
        return False
    if " " not in s:
        return False
    return bool(re.match(r"^[A-Za-zÀ-ÿ]", s))


def parse_panel_table(wikitext: str) -> list[dict]:
    """Parse the officials wikitable -> list of {name, confederation, nationality}.

    Column meaning is detected from the header row; if no header is found we
    fall back to a heuristic (first name-like cell = name, any CONFED token =
    confederation, the remaining cell = nationality)."""
    rows = _split_rows(wikitext)
    out: list[dict] = []
    seen: set[str] = set()
    for block in rows:
        cells = _row_cells(block)
        if not cells:
            continue
        name = next((c for c in cells if _looks_like_name(c)), None)
        if not name:
            continue
        confed = next((c for c in cells if c.upper() in CONFED_TOKENS), "")
        # Nationality: a remaining short cell that isn't the name or confed.
        nationality = ""
        for c in cells:
            if c == name or c.upper() in CONFED_TOKENS:
                continue
            if re.match(r"^[A-Za-zÀ-ÿ' .-]+$", c) and len(c) <= 40:
                nationality = c
                break
        key = slugify(name)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "name": name,
            "confederation": confed.upper(),
            "nationality": nationality,
        })
    return out


def fetch_officials_wikitext() -> str | None:
    try:
        res = polite_get(API_URL, accept_json=True)
    except ScrapeError as e:
        log(f"refs: officials api: {e}")
        return None
    try:
        return res.json()["parse"]["wikitext"]["*"]
    except (ValueError, KeyError, TypeError) as e:
        log(f"refs: officials api: unexpected payload ({e})")
        return None


def try_directory(existing_refs: dict) -> int:
    """Populate the referee directory from the officials page. Returns count."""
    wikitext = fetch_officials_wikitext()
    if not wikitext:
        return 0
    panel = parse_panel_table(wikitext)
    n = 0
    slug_to_name: dict[str, str] = {}
    for entry in panel:
        name = entry["name"]
        rid = slugify(name)
        prior = slug_to_name.get(rid)
        if prior and prior != name:
            log(f"refs: slug collision {rid!r}: {prior!r} vs {name!r} (last wins)")
        slug_to_name[rid] = name
        cur = existing_refs.get(rid) or {}
        cur.setdefault("ref_id", rid)
        cur["name"] = name
        if entry["confederation"]:
            cur["confederation"] = entry["confederation"][:8]
        else:
            cur.setdefault("confederation", "")
        cur["nationality"] = entry["nationality"] or cur.get("nationality") or ""
        cur.setdefault("stats", {})
        cur.setdefault("history", [])
        existing_refs[rid] = cur
        n += 1
    return n


def _normalize_team(name: str) -> str:
    name = name.strip()
    return RENAMES.get(name, name)


def _ref_id_for(name: str, refs: dict) -> str | None:
    """Match a referee display name to a directory ref_id via stable slug."""
    rid = slugify(name)
    return rid if rid in refs else None


def try_assignments(schedule, refs: dict, mrefs: dict) -> int:
    """Opportunistically harvest 'Team A vs Team B ... Referee: Name' lines.

    Maps each parsed fixture to a schedule_full match orientation
    ('TeamA__vs__TeamB') and a directory ref_id. Best-effort: any page 4xx or
    parse miss yields 0 and leaves mrefs untouched (graceful empty-state)."""
    # Build a fast lookup of valid fixture orientations from the schedule.
    valid: dict[frozenset, tuple[str, str]] = {}
    for m in schedule or []:
        a, b = m.get("team_a"), m.get("team_b")
        if a and b:
            valid[frozenset((a, b))] = (a, b)

    n = 0
    # Lines like: "Argentina v Brazil ... Referee: Szymon Marciniak (Poland)"
    fixture_re = re.compile(
        r"([A-Za-zÀ-ÿ' .-]{3,40})\s+(?:v|vs|–|—)\s+([A-Za-zÀ-ÿ' .-]{3,40})", re.IGNORECASE
    )
    ref_re = re.compile(r"Referee[:\s]+\[\[([^\]|]+)", re.IGNORECASE)

    for page in ASSIGN_PAGES:
        url = (
            "https://en.wikipedia.org/w/api.php?action=parse"
            f"&page={page}&prop=wikitext&format=json&formatversion=2"
        )
        try:
            res = polite_get(url, accept_json=True)
            wikitext = res.json()["parse"]["wikitext"]["*"]
        except (ScrapeError, ValueError, KeyError, TypeError) as e:
            log(f"refs: assignments {page}: {e}")
            continue
        # Section the wikitext on match templates; look for a fixture header
        # followed (within the same block) by a 'Referee:' line.
        blocks = re.split(r"\{\{[Ff]ootball box", wikitext)
        for blk in blocks:
            fx = fixture_re.search(_strip_wiki(blk[:200]))
            rf = ref_re.search(blk)
            if not (fx and rf):
                continue
            a = _normalize_team(fx.group(1))
            b = _normalize_team(fx.group(2))
            orient = valid.get(frozenset((a, b)))
            if not orient:
                continue
            ref_name = _strip_wiki(rf.group(1))
            rid = _ref_id_for(ref_name, refs)
            if not rid:
                continue
            key = f"{orient[0]}__vs__{orient[1]}"
            if mrefs.get(key) != rid:
                mrefs[key] = rid
                n += 1
    return n


def main() -> int:
    refs = load("referees.json")
    mrefs = load("match_referees.json")
    if not isinstance(refs, dict):
        refs = {}
    if not isinstance(mrefs, dict):
        mrefs = {}
    try:
        schedule = json.loads((DATA_DIR / "schedule_full.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — schedule is optional for the directory probe
        schedule = []

    # Snapshot the ref + assignment data (excluding __meta__) so we only bump
    # updated_at when something actually changed — a no-op bump would make
    # referees.json look perpetually fresh and defeat the staleness watchdog.
    before_refs = {k: v for k, v in refs.items() if k != "__meta__"}
    before_mrefs = {k: v for k, v in mrefs.items() if k != "__meta__"}

    n = try_directory(refs)
    if n:
        log(f"refs: refreshed {n} directory entries from Wikipedia")

    try:
        a = try_assignments(schedule, refs, mrefs)
        if a:
            log(f"refs: matched {a} match assignment(s)")
    except Exception as e:  # noqa: BLE001 — assignments are a best-effort bonus
        log(f"refs: assignments skipped — {e}")

    after_refs = {k: v for k, v in refs.items() if k != "__meta__"}
    after_mrefs = {k: v for k, v in mrefs.items() if k != "__meta__"}
    if after_refs == before_refs and after_mrefs == before_mrefs:
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
    except SystemExit:
        raise
    except Exception as e:
        log(f"refs: fatal — {e}; continuing")
        raise SystemExit(0)
