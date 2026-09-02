#!/bin/sh
# Daily re-generation of WorldMonitor's AI regional intelligence briefs.
#
# WHY: seed-regional-briefs.mjs takes ~200s (granite generates each region's brief
# sequentially) and the shared run-seeders.sh cron kills it under its per-seeder
# SEED_TIMEOUT cap → intelligence:regional-briefs narratives stay empty. This runs it
# standalone with a 15-min ceiling. Granite is CPU-pinned (ollama ps: 100% CPU) so it
# does NOT evict the GPU-resident qwen3.6:27b (IronClaw's brain + vibetrading).
# Installed via prime's crontab: 30 5 * * *  (added 2026-08-12)
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="/home/prime/.nvm/versions/node/v24.18.0/bin:$PATH"
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
fi
export UPSTASH_REDIS_REST_URL="${UPSTASH_REDIS_REST_URL:-http://localhost:8079}"
if [ -n "${REDIS_TOKEN:-}" ]; then export UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"; fi
cd "$PROJECT_DIR"
# Both local-LLM (granite/CPU) seeders that overrun the shared per-seeder cap.
# seed-insights needs OLLAMA_API_URL/OLLAMA_MODEL in .env (host-only; NOT in compose)
# to use local granite instead of cloud groq (403 without a key).
for s in seed-regional-briefs seed-insights; do
  printf '%s %s ... ' "$(date -u +%FT%TZ)" "$s"
  if timeout 1200 node "scripts/$s.mjs" >/tmp/wm-briefs-seed.out 2>&1; then
    grep -oE 'generated=[0-9]+ skipped=[0-9]+ failed=[0-9]+|"recordCount":[0-9]+' /tmp/wm-briefs-seed.out | tail -1 || echo OK
  else
    # A TIMEOUT IS NOT A ONE-REGION FAILURE. `tail -3` shows whichever region was in
    # flight when the ceiling killed the job, so 2026-09-01 and 09-02 both read as
    # "east-asia: all providers failed" when in fact NOTHING completed either day and the
    # stored briefs went 54.7h stale. Say which it was.
    rc=$?
    echo FAIL
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
      echo "  KILLED at the ${TIMEOUT_S:-1200}s ceiling — this is a whole-job timeout, not the one region named below"
    fi
    tail -3 /tmp/wm-briefs-seed.out
    # AND TELL SOMEONE. This wrapper had no notify at all, so two consecutive days of
    # total failure produced zero alerts and were found only by reading stored timestamps.
    # Same gap as OnFailure wired for some units and never extended to the rest.
    bash /home/prime/tool-integrations/notify.sh worldmonitor-briefs FAILED \
      "seed-$s failed (rc=$rc). $( [ "$rc" -eq 124 ] && echo 'Killed at the ceiling — no briefs were written; stored briefs are going stale.' )$(tail -2 /tmp/wm-briefs-seed.out | tr '\n' ' ')"
  fi
done

# Release the CPU-pinned granite model when the nightly run is done (added 2026-08-13).
# mirofish-granite is ~19.5 GB of the box's 62 GB and ollama holds it FOREVER
# (OLLAMA_KEEP_ALIVE=-1), so without this the seeder's working set never comes back —
# on a box whose documented crash mode is RAM exhaustion during a parallel cargo build.
# Must use the NATIVE /api/generate: the /v1 OpenAI-compatible route IGNORES keep_alive.
# Cost of unloading: WorldMonitor's on-demand AI panels pay a model reload (~15s) on the
# first request afterwards; the nightly briefs they mostly read are already cached.
printf '%s unload-granite ... ' "$(date -u +%FT%TZ)"
if curl -sf -m 30 http://127.0.0.1:11434/api/generate \
     -d '{"model":"mirofish-granite:latest","keep_alive":0}' >/dev/null 2>&1; then
  echo "released"
else
  echo "SKIP (ollama unreachable — not fatal)"
fi
