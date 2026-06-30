#!/usr/bin/env python3
"""RJ30-12 — pipeline observability artifact builder.

Writes data/pipeline_status.json: a small, committed, steady-state health
surface for the data pipeline that the in-app #/status view renders. Zero new
infra — it reuses the existing daily cron + Netlify deploy. Issues stay reserved
for failures (check_staleness); this is the quiet "everything's alive" surface.

For each watched feed it records {name, updated_at, age_hours, rows, status}
where status ∈ {ok, stale, empty, missing}; folds in the validate warnings list
(from `validate_data.py --json-report`); and sets an overall
health ∈ {ok, degraded}. Degraded iff any feed is empty/missing/stale OR any
validate warning exists.

Non-blocking by contract: any unexpected error is swallowed and we exit 0 so
observability can never fail the data refresh. Mirrors scrape_referees.py's
no-op-bump (don't churn a Netlify redeploy when status is unchanged) and the
repo's ensure_ascii + atomic tmp+replace write convention.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "data"

# Feeds whose freshness/emptiness is worth surfacing. Mirrors check_staleness's
# EMPTY_WATCH set (the volatile, fan-facing scrapers that fail silently under
# continue-on-error) plus the durable strength inputs.
WATCH = [
    "teams.json",
    "players.json",
    "scorers.json",
    "markets.json",
    "form.json",
    "schedule_full.json",
    "actual_results.json",
    "referees.json",
]

# Mirror of check_staleness.THRESHOLD_HOURS / tournament gating: only mark a feed
# "stale" by age during the tournament window (avoids off-season false positives
# for feeds that legitimately don't move out of season).
THRESHOLD_HOURS = 36
TOURNAMENT_START = "2026-06-11"
TOURNAMENT_END = "2026-07-20"

# scorers.json has no reliable free WC upstream — it's KNOWN-DARK (tracked by
# check_staleness), so an empty scorers feed should NOT flip overall health to
# degraded on its own. It still reports its real status for visibility.
KNOWN_DARK = {"scorers.json"}


def log(m: str) -> None:
    print(f"[pipeline-status] {m}", file=sys.stderr, flush=True)


def _payload_count(name: str, obj) -> int:
    """Substantive row count, ignoring __meta__ wrappers (mirrors check_staleness)."""
    if name.endswith("markets.json") and isinstance(obj, dict):
        return len(obj.get("tournament_winner") or [])
    if isinstance(obj, dict):
        return len([k for k in obj if k != "__meta__"])
    if isinstance(obj, list):
        return len(obj)
    return 0


def _updated_at(name: str, obj) -> str | None:
    if isinstance(obj, dict):
        meta = obj.get("__meta__")
        if isinstance(meta, dict) and isinstance(meta.get("updated_at"), str):
            return meta["updated_at"]
        # markets.json / consensus carry a top-level updated_at.
        if isinstance(obj.get("updated_at"), str):
            return obj["updated_at"]
    return None


def _age_hours(updated_at: str | None, now: datetime) -> float | None:
    if not updated_at:
        return None
    try:
        dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return round((now - dt).total_seconds() / 3600.0, 1)


def _in_window(now: datetime) -> bool:
    today = now.strftime("%Y-%m-%d")
    return TOURNAMENT_START <= today <= TOURNAMENT_END


def build_status(data_dir: Path, validate_report: Path | None, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    in_window = _in_window(now)
    feeds = []
    any_problem = False
    for name in WATCH:
        p = data_dir / name
        if not p.exists():
            feeds.append({"name": name, "updated_at": None, "age_hours": None,
                          "rows": 0, "status": "missing"})
            any_problem = True
            continue
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            # A malformed feed must NOT crash the builder (non-blocking).
            feeds.append({"name": name, "updated_at": None, "age_hours": None,
                          "rows": 0, "status": "missing"})
            any_problem = True
            continue
        rows = _payload_count(name, obj)
        ua = _updated_at(name, obj)
        age = _age_hours(ua, now)
        if rows == 0:
            status = "empty"
        elif in_window and age is not None and age > THRESHOLD_HOURS:
            status = "stale"
        else:
            status = "ok"
        feeds.append({"name": name, "updated_at": ua, "age_hours": age,
                      "rows": rows, "status": status})
        if status != "ok" and name not in KNOWN_DARK:
            any_problem = True

    warnings: list[str] = []
    if validate_report and validate_report.exists():
        try:
            rep = json.loads(validate_report.read_text(encoding="utf-8"))
            warnings = list(rep.get("warnings") or [])
        except (ValueError, OSError):
            warnings = []

    health = "degraded" if (any_problem or warnings) else "ok"
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "health": health,
        "feeds": feeds,
        "warnings": warnings,
        "warning_count": len(warnings),
    }


def _write_if_changed(out: Path, status: dict) -> bool:
    """No-op-bump: only rewrite when content (excluding generated_at) changed, so
    an unchanged status doesn't churn a Netlify redeploy. Returns True if written."""
    prior = None
    if out.exists():
        try:
            prior = json.loads(out.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            prior = None

    def _cmp(d):
        d = dict(d or {})
        d.pop("generated_at", None)
        return d

    if prior is not None and _cmp(prior) == _cmp(status):
        log("no status change; leaving generated_at untouched")
        return False

    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text(json.dumps(status, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    tmp.replace(out)
    log(f"wrote {out.name} (health={status['health']}, {len(status['feeds'])} feeds, "
        f"{status['warning_count']} warning(s))")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", default=str(DEFAULT_DATA))
    ap.add_argument("--validate-report", default=None,
                    help="Path to the validate_data.py --json-report sidecar.")
    ap.add_argument("--out", default=None,
                    help="Output path (default: <data-dir>/pipeline_status.json).")
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    out = Path(args.out) if args.out else data_dir / "pipeline_status.json"
    vr = Path(args.validate_report) if args.validate_report else None

    status = build_status(data_dir, vr)
    _write_if_changed(out, status)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — observability must never fail the refresh
        log(f"fatal — {e}; continuing")
        raise SystemExit(0)
