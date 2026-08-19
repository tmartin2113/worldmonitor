#!/usr/bin/env bash
# Keep the CII risk-score cache warm.
#
# WHY THIS EXISTS. risk:scores:sebuf:v8 and :stale:v8 are NOT written by any
# seeder. They are computed lazily by the get-risk-scores endpoint and cached on
# the way out (get-risk-scores.ts ~L1545). On a hosted site that is fine: visitor
# traffic keeps them warm. This box has no visitors, so nothing ever called it,
# so the keys never existed — and get-country-risk needs THREE keys and fails
# closed if any one is missing. Every country returned upstreamUnavailable:true.
#
# The TTLs are short by design for a trafficked site: live ~10 min, stale ~1h.
# So a daily cron would not fix it either; this must run well inside the stale
# TTL. Every 30 minutes gives a 2x margin.
#
# Found 2026-08-18. This is the same TTL-versus-cadence bug as the seeders had,
# except the "cadence" here is user traffic that does not exist on a self-hosted
# instance. See memory: worldmonitor-silent-noop-seeders.
set -uo pipefail

BASE="${WM_BASE_URL:-http://127.0.0.1:3300}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT INT TERM

log() { printf '%s [warm-risk-scores] %s\n' "$(date -Is)" "$*"; }

# The endpoint is session-authenticated; /api/wm-session mints the cookie.
if ! curl -sf -c "$JAR" -m 20 -X POST "$BASE/api/wm-session" \
      -H 'content-type: application/json' -d '{}' >/dev/null 2>&1; then
  log "FAILED to mint a session against $BASE — cache NOT warmed"
  exit 1
fi

code="$(curl -s -b "$JAR" -m 120 -o /dev/null -w '%{http_code}' \
        "$BASE/api/intelligence/v1/get-risk-scores" 2>/dev/null)"

if [ "$code" != "200" ]; then
  log "get-risk-scores returned HTTP ${code:-000} — cache NOT warmed"
  exit 1
fi

# VERIFY THE WRITE, don't infer it from a 200. A 200 served from a response
# cache would leave the redis keys untouched, which is exactly the failure this
# script exists to prevent — and would look identical from the outside.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
if [ -f "$DIR/.env" ]; then set -a; . "$DIR/.env"; set +a; fi
RU="${UPSTASH_REDIS_REST_URL:-http://localhost:8079}"
RT="${UPSTASH_REDIS_REST_TOKEN:-${REDIS_TOKEN:-}}"
ttl="$(curl -s -m 10 -H "Authorization: Bearer $RT" "$RU/ttl/risk:scores:sebuf:stale:v8" 2>/dev/null \
       | sed -n 's/.*"result":\(-\?[0-9]*\).*/\1/p')"

if [ -z "$ttl" ] || [ "$ttl" -lt 0 ] 2>/dev/null; then
  log "HTTP 200 but the stale key is ABSENT (ttl=${ttl:-unreadable}) — get-country-risk will fail closed"
  exit 1
fi

log "OK risk scores warm (stale key ttl=${ttl}s)"
exit 0
