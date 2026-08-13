#!/bin/sh
# Frequent re-seed of the short-TTL, keyless natural-hazard feeds.
#
# WHY: seismology:earthquakes:v1 carries a ~6h Redis TTL and natural:events:v1
# ~12h, but the full run-seeders.sh cron only fires once daily at 04:00 — so the
# earthquake key expires by ~10:00 and the Disaster Cascade panel + `natural` map
# layer sit at "Waiting for data" the rest of the day. This wrapper re-seeds just
# those two every 4h (inside the 6h TTL) to keep them live. Keyless: USGS/GDACS/EONET.
#
# Installed via prime's crontab: 0 */4 * * *  (added 2026-08-11)
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="/home/prime/.nvm/versions/node/v24.18.0/bin:$PATH"

# Load REDIS_TOKEN from .env (mirrors run-seeders.sh); never printed.
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
fi
export UPSTASH_REDIS_REST_URL="${UPSTASH_REDIS_REST_URL:-http://localhost:8079}"
if [ -n "${REDIS_TOKEN:-}" ]; then
  export UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"
fi
if [ -z "${UPSTASH_REDIS_REST_TOKEN:-}" ]; then
  echo "$(date -u +%FT%TZ) ERROR: REDIS_TOKEN/UPSTASH_REDIS_REST_TOKEN missing" >&2
  exit 1
fi

cd "$PROJECT_DIR"
for s in seed-earthquakes seed-natural-events; do
  printf '%s %s ... ' "$(date -u +%FT%TZ)" "$s"
  if timeout 150 node "scripts/$s.mjs" >/tmp/wm-hazard-seed.out 2>&1; then
    grep -oE '"recordCount":[0-9]+' /tmp/wm-hazard-seed.out | tail -1 || echo "OK"
  else
    echo "FAIL"; tail -3 /tmp/wm-hazard-seed.out
  fi
done
