#!/usr/bin/env bash
# WC26 Tracker — pre-deploy smoke test.
#
# Spins up a python http.server on a free port, curls every shipping asset
# (HTML + data JSON + manifest + sw + icons), asserts HTTP 200 + a tiny shape
# check on each JSON payload, then tears the server down.
#
# Usage:
#   bash tests/smoke.sh                       # uses repo root as the docroot
#   bash tests/smoke.sh path/to/docroot       # custom docroot
#   bash tests/smoke.sh '' https://site.url/  # remote URL only (no local server)
#
# Exit codes:
#   0 = everything green
#   1 = one or more checks failed
set -euo pipefail

DOCROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
REMOTE_BASE="${2:-}"

BASE_URL=""
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

start_local() {
  for port in $(seq 8801 8899); do
    if ! lsof -ti:"$port" >/dev/null 2>&1; then
      (cd "$DOCROOT" && python3 -m http.server "$port" >/dev/null 2>&1) &
      SERVER_PID=$!
      BASE_URL="http://localhost:${port}"
      sleep 1
      if curl -sS -o /dev/null --max-time 3 "$BASE_URL/"; then
        return 0
      fi
    fi
  done
  echo "smoke: could not start local server" >&2
  exit 1
}

if [[ -n "$REMOTE_BASE" ]]; then
  BASE_URL="${REMOTE_BASE%/}"
  echo "smoke: testing remote $BASE_URL"
else
  start_local
  echo "smoke: testing local $BASE_URL (docroot=$DOCROOT)"
fi

FAILED=0
fail() { echo "  FAIL: $*" >&2; FAILED=$((FAILED + 1)); }
ok()   { echo "  ok:   $*"; }

check_200() {
  local path="$1" label="${2:-$1}"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL$path" || echo "000")
  if [[ "$code" == "200" ]]; then ok "$label ($code)"; else fail "$label expected 200, got $code"; fi
}

check_json_shape() {
  local path="$1" python_check="$2" label="${3:-$1}"
  local body code
  body=$(curl -sS -w '\n%{http_code}' "$BASE_URL$path" || true)
  code=$(printf '%s' "$body" | tail -n1)
  body=$(printf '%s' "$body" | sed '$d')
  if [[ "$code" != "200" ]]; then
    fail "$label HTTP $code (expected 200)"
    return
  fi
  if python3 - "$python_check" <<EOF >/dev/null 2>"/tmp/wc26_smoke_err"
import json, sys
body = """$body"""
data = json.loads(body)
exec(sys.argv[1])
EOF
  then
    ok "$label shape"
  else
    fail "$label shape check: $(cat /tmp/wc26_smoke_err)"
  fi
}

echo "smoke: shell assets"
check_200 "/"                       "GET /"
check_200 "/index.html"             "GET /index.html"
check_200 "/manifest.json"          "GET /manifest.json"
check_200 "/sw.js"                  "GET /sw.js"
check_200 "/app/styles.css"         "GET /app/styles.css"
check_200 "/app/main.js"            "GET /app/main.js"
check_200 "/icons/icon-192.png"     "GET /icons/icon-192.png"
check_200 "/icons/icon-512.png"     "GET /icons/icon-512.png"
check_200 "/icons/icon-maskable.png" "GET /icons/icon-maskable.png"

echo "smoke: data shape"
check_json_shape "/data/meta.json" \
  "assert isinstance(data, dict) and data.get('data_version'), data" \
  "data/meta.json"
check_json_shape "/data/group_matchups.json" \
  "assert sorted(data.keys()) == list('ABCDEFGHIJKL'), sorted(data.keys()); \
       [exec(\"assert len(v['matches']) == 6, (k, len(v['matches']))\") for k, v in data.items()]" \
  "data/group_matchups.json"
check_json_shape "/data/teams.json" \
  "assert isinstance(data, dict) and len(data) == 48, len(data)" \
  "data/teams.json"
check_json_shape "/data/schedule.json" \
  "assert 'opening_match' in data and 'final' in data" \
  "data/schedule.json"
check_json_shape "/data/actual_results.json" \
  "assert all(k in data for k in ['group_stage','round_of_32','round_of_16','quarterfinals','semifinals','third_place','final']), list(data.keys())" \
  "data/actual_results.json"
check_json_shape "/data/players.json" \
  "assert isinstance(data, list) and len(data) > 100, len(data)" \
  "data/players.json"

echo "smoke: phase-2 data shape"
check_json_shape "/data/venues.json" \
  "assert isinstance(data, list) and len(data) == 16, len(data)" \
  "data/venues.json"
check_json_shape "/data/schedule_full.json" \
  "assert isinstance(data, list) and len(data) == 104, len(data); \
       [exec(\"assert 'match_id' in r and 'kickoff_utc' in r and 'venue_id' in r, r\") for r in data]" \
  "data/schedule_full.json"
check_json_shape "/data/lineups.json"        "assert isinstance(data, dict), type(data).__name__"        "data/lineups.json"
check_json_shape "/data/referees.json"       "assert isinstance(data, dict), type(data).__name__"        "data/referees.json"
check_json_shape "/data/match_referees.json" "assert isinstance(data, dict), type(data).__name__"        "data/match_referees.json"
check_json_shape "/data/h2h.json"            "assert isinstance(data, dict), type(data).__name__"        "data/h2h.json"
check_json_shape "/data/form.json"           "assert isinstance(data, dict), type(data).__name__"        "data/form.json"
check_json_shape "/data/scorers.json"        "assert isinstance(data, dict), type(data).__name__"        "data/scorers.json"
check_json_shape "/data/weather.json"        "assert isinstance(data, dict), type(data).__name__"        "data/weather.json"
check_json_shape "/data/injuries.json"       "assert isinstance(data, dict) and isinstance(data.get('by_team', {}), dict), type(data).__name__" "data/injuries.json"
check_json_shape "/data/fatigue.json"        "assert isinstance(data, dict) and len(data) >= 70, len(data)" "data/fatigue.json"
check_json_shape "/data/xg.json"             "assert isinstance(data, dict) and len(data) >= 70, len(data)" "data/xg.json"
check_json_shape "/data/markets.json" \
  "assert data.get('source')=='kalshi' and isinstance(data.get('tournament_winner'), list) and len(data['tournament_winner'])>=40, len(data.get('tournament_winner',[]))" \
  "data/markets.json"
check_json_shape "/data/team_colors.json" \
  "teams = {k: v for k, v in data.items() if k != '__meta__'}; assert isinstance(data, dict) and len(teams) >= 40 and all('primary' in v for v in teams.values()), len(data)" \
  "data/team_colors.json"
check_json_shape "/data/schedule_source.json" \
  "assert isinstance(data.get('matches'), list) and len(data['matches']) == 104, len(data.get('matches',[]))" \
  "data/schedule_source.json"

echo "smoke: manifest shape"
check_json_shape "/manifest.json" \
  "assert data.get('name') and data.get('start_url') and data.get('icons'), data" \
  "manifest.json"

# RJ30: syntax-check the service worker + push Netlify functions, and run the
# pure (no-network) self-tests for the new pipeline scripts. set -e is active, so
# instead of letting a non-zero abort the run, route each through the FAILED
# counter for a consistent final summary + exit code.
echo "smoke: node syntax checks (sw + push functions)"
SMOKE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node_check() {
  local f="$1"
  if node --check "$SMOKE_ROOT/$f" 2>/tmp/wc26_smoke_node_err; then
    ok "node --check $f"
  else
    fail "node --check $f: $(cat /tmp/wc26_smoke_node_err)"
  fi
}
node_check "sw.js"
node_check "netlify/functions/push-notify.mjs"
node_check "netlify/functions/_lib/push-diff-core.mjs"
node_check "netlify/functions/_lib/web-push.mjs"

echo "smoke: python script self-tests"
py_self_test() {
  local script="$1"
  if python3 "$SMOKE_ROOT/$script" --self-test >/dev/null 2>/tmp/wc26_smoke_py_err; then
    ok "python3 $script --self-test"
  else
    fail "python3 $script --self-test: $(cat /tmp/wc26_smoke_py_err)"
  fi
}
py_self_test "scripts/refresh_players.py"
py_self_test "scripts/scrape_live_results.py"
py_self_test "scripts/generate_previews.py"
py_self_test "scripts/compute_dominance.py"
py_self_test "scripts/build_ko_context.py"

if (( FAILED > 0 )); then
  echo "smoke: FAILED ($FAILED check(s))"
  exit 1
fi
echo "smoke: OK"
