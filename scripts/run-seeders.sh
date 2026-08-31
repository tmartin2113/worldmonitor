#!/bin/sh
# Run all seed scripts against the local Redis REST proxy.
# Usage: ./scripts/run-seeders.sh
#
# Requires the worldmonitor stack to be running (uvx podman-compose up -d).
# The Redis REST proxy listens on localhost:8079 by default.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load REDIS_TOKEN (and any seeder API keys present) from .env so the
# host-side seeders can talk to the REST proxy with the same bearer the
# compose stack is using. Defaults removed in #3804 — the seeders fail-loud
# if REDIS_TOKEN is not in the environment or .env.
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
fi

UPSTASH_REDIS_REST_URL="${UPSTASH_REDIS_REST_URL:-http://localhost:8079}"
# This script targets the LOCAL Docker REST proxy, so REDIS_TOKEN always
# wins if set — even when UPSTASH_REDIS_REST_TOKEN also appears in .env
# (e.g. a contributor who also works on the Vercel/Upstash side and keeps
# the production token in the same file). Otherwise we'd silently send a
# Vercel-Upstash bearer to localhost:8079 and the proxy would 401 the
# request with no hint about why. Reviewer caught this on PR #3829.
if [ -n "${REDIS_TOKEN:-}" ]; then
  UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"
fi
if [ -z "${UPSTASH_REDIS_REST_TOKEN:-}" ]; then
  echo "ERROR: REDIS_TOKEN (or UPSTASH_REDIS_REST_TOKEN) is required." >&2
  echo "       Generate with: openssl rand -hex 32, then add to .env" >&2
  echo "       See SELF_HOSTING.md → Required Environment Variables." >&2
  exit 1
fi
export UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN

# Source API keys from docker-compose.override.yml if present.
# These keys are configured for the container but seeders run on the host.
OVERRIDE="$PROJECT_DIR/docker-compose.override.yml"
if [ -f "$OVERRIDE" ]; then
  _env_tmp=$(mktemp)
  grep -E '^\s+[A-Z_]+:' "$OVERRIDE" \
    | grep -v '#' \
    | sed 's/^\s*//' \
    | sed 's/: */=/' \
    | sed "s/[\"']//g" \
    | grep -E '^(NASA_FIRMS|GROQ|AISSTREAM|FRED|FINNHUB|EIA|ACLED_ACCESS_TOKEN|ACLED_EMAIL|ACLED_PASSWORD|CLOUDFLARE|AVIATIONSTACK|OPENAQ_API_KEY|WAQI_API_KEY|OPENROUTER_API_KEY|LLM_API_URL|LLM_API_KEY|LLM_MODEL|OLLAMA_API_URL|OLLAMA_MODEL)' \
    | sed 's/^/export /' > "$_env_tmp"
  . "$_env_tmp"
  rm -f "$_env_tmp"
fi
# Per-seeder wall-clock cap for STANDALONE seeders. They run sequentially, so a
# single upstream that hangs (e.g. a slow NOAA/NSIDC fetch that doesn't honour its
# own AbortSignal and keeps the node process alive for an hour) would burn the rest
# of the window and starve every later seeder — under a wrapping systemd/cron job
# timeout it drops everything after the hung one. Capping each seeder bounds that
# blast radius. Default 1800s (30min): above any standalone seeder's real runtime
# yet below the pathological hangs (60min+), so it kills only runaway runs.
# Override with SEED_TIMEOUT=<seconds>, or SEED_TIMEOUT=0 to disable.
#
# Bundle seeders (seed-bundle-*.mjs) are EXEMPT from this cap: scripts/_bundle-runner.mjs
# already hard-caps every section with its own wall-clock timer (SIGTERM→SIGKILL on
# the section's child PID — immune to the DNS-hang blind spot) and runs sections
# sequentially, so a bundle's *legitimate* total can exceed SEED_TIMEOUT (e.g.
# resilience-recovery's Import-HHI section alone budgets 30min). Wrapping a bundle in
# the outer cap would false-kill it mid-run and orphan the in-flight section child.
SEED_TIMEOUT="${SEED_TIMEOUT:-1800}"

# Resolve once whether the outer cap is usable (timeout(1) present and a positive
# numeric budget). Non-numeric/empty SEED_TIMEOUT → test errors → disabled (plain node).
if command -v timeout >/dev/null 2>&1 && [ "${SEED_TIMEOUT:-0}" -gt 0 ] 2>/dev/null; then
  timeout_enabled=true
else
  timeout_enabled=false
fi

# Bundle seeders self-bound per section — never wrap them in the outer cap.
is_bundle() {
  case "$1" in
    *seed-bundle-*) return 0 ;;
    *) return 1 ;;
  esac
}

# Whether THIS seeder is wrapped by the outer timeout.
caps_seed() {
  [ "$timeout_enabled" = true ] && ! is_bundle "$1"
}

run_seed() {
  if caps_seed "$1"; then
    # -k: if it ignores SIGTERM, SIGKILL it 30s later so the run can move on.
    timeout -k 30 "$SEED_TIMEOUT" node "$1" 2>&1
  else
    node "$1" 2>&1
  fi
}

ok=0 fail=0 skip=0 timedout=0 excluded=0 nokey=0 deferred=0 depfail=0

# MANUAL-ONLY SEEDERS ARE EXCLUDED, NOT RUN AND COUNTED AS FAILURES.
#
# seed-consumer-prices.mjs requires --force by design: an authoritative publisher
# owns its keys with a 26h TTL, this script writes 10-60min TTLs, and whichever runs
# last wins. Its own header says "Do NOT configure as a cron". The nightly glob ran
# it anyway, it correctly refused, and the refusal was logged as FAIL every night —
# so a working safety guard was indistinguishable from a broken seeder in the only
# place anyone looks.
#
# Detected from the file's own docstring rather than a hardcoded list, so a future
# manual-only seeder is excluded the day it is written instead of the day someone
# notices it in the failure count.
manual_only() {
  head -40 "$1" | grep -qiE 'MANUAL FALLBACK|Do NOT configure as a|MANUAL ONLY'
}

# RUN MARKER. The cron entry appends (it used to truncate, so there was exactly one run
# in the file and no way to tell a rising failure count from a stable one). An appending
# log needs a delimiter or the runs blur into one wall of text, so stamp the start and
# stamp the summary — same shape as seeder-tier.log, which has always appended.
echo "=== $(date -u +%FT%TZ) run-seeders start ==="

for f in "$SCRIPT_DIR"/seed-*.mjs; do
  name="$(basename "$f")"
  if manual_only "$f"; then
    printf "→ %s ... EXCLUDED (manual-only by its own header)\n" "$name"
    excluded=$((excluded + 1))
    continue
  fi
  printf "→ %s ... " "$name"
  output=$(run_seed "$f")
  rc=$?
  last=$(echo "$output" | tail -1)

  # timeout(1) exits 124 when it had to terminate the child, or 128+signal
  # (137 = SIGKILL after the -k grace) when SIGTERM was ignored. Only trust this
  # classification for seeders we actually wrapped (bundles run unwrapped).
  if caps_seed "$f" && { [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; }; then
    printf "TIMEOUT (killed after %ss)\n" "$SEED_TIMEOUT"
    timedout=$((timedout + 1))
  # A BUNDLE THAT REPORTS FAILURES IS NOT A SKIP. Bundle seeders end with a
  # summary line like "Finished in 254.3s, ran:0 skipped:2 deferred:0 failed:3",
  # and the skip branch below greps the last line for "skip" — which "skipped:2"
  # matches. Because that branch sits ABOVE the exit-code check, a bundle with
  # three dead sections was printed as SKIP and counted as a skip. Measured
  # 2026-08-19: 9 of 27 SKIP entries were hiding 11 failed sections between them
  # (climate failed:3, energy-sources failed:2, seven more at failed:1), and those
  # sections own domains that /api/seed-health separately reports as MISSING.
  # The harness was the reason nobody connected the two.
  #
  # Same class as run-tier.sh counting exit-0 as success, fixed the same morning:
  # a classifier that reads a summary line for a keyword instead of for its
  # numbers. Check the numbers first.
  elif echo "$last" | grep -qE 'failed:[1-9]'; then
    printf "FAIL (%s)\n" "$last"
    fail=$((fail + 1))
  # A CREDENTIAL DECLINE IS NOT A CRASH, AND ITS MESSAGE IS NOT ON THE LAST LINE.
  #
  # seed-health-air-quality prints "Missing OPENAQ_API_KEY" and then ends with
  # "=== Fatal configuration error ==="; seed-eia-petroleum prints "EIA_API_KEY not
  # set" and ends "=== Failed gracefully ===". The skip branch below only reads the
  # LAST line, so both were counted as FAIL every night. A seeder correctly
  # declining for want of a key is indistinguishable from one that crashed — the
  # same defect already found for manual-only scripts, one layer along.
  #
  # NOKEY is its own state rather than folded into SKIP, because it is ACTIONABLE:
  # it names the exact credential to obtain. Burying it in a skip count is how it
  # stayed invisible.
    #
    # A FOURTH PHRASING, 2026-08-31. The pattern above required a var ending in _KEY with
    # the decline words adjacent to it, so three more declines were counted FAIL nightly:
    #   seed-aviation                 "No AVIATIONSTACK_API key"   - no _KEY suffix
    #   seed-recovery-reexport-share  "COMTRADE_API_KEYS not set"  - plural breaks adjacency
    #   seed-climate-disasters        "RELIEFWEB_APPNAME not set"  - not a KEY at all
    # Widened to any credential-SHAPED token next to a decline phrase.
    #
    # BROADENING THIS HIDES REAL FAILURES IF IT OVERREACHES, so it was tested in BOTH
    # directions before shipping: 5/5 known declines classify NOKEY, and 6/6 genuine
    # failures still classify FAIL - HTTP 403, an exhausted ollama budget, a missing npm
    # package, a connect timeout, a 500, and a TypeError.
    elif echo "$output" | grep -qoE '(Missing|missing|No|no) +[A-Z][A-Z0-9_]{2,}(_KEY|_KEYS|_TOKEN|_SECRET|_API|_APPNAME|_PASSWORD|_USER)?( +key)?|[A-Z][A-Z0-9_]{2,}(_KEY|_KEYS|_TOKEN|_SECRET|_API|_APPNAME|_PASSWORD|_USER) +not set'; then
      # NAME EVERY CREDENTIAL IT DECLINED FOR, from the decline lines only.
      # A head -1 over the whole output named the first credential-shaped token anywhere:
      # seed-aviation reported ICAO_API_KEY, which is a PARTIAL skip (it still wrote FAA
      # data), while the credential that actually failed the run was AVIATIONSTACK_API.
      # Naming one of several sends the reader shopping for the wrong thing, so list all.
      key=$(echo "$output" | grep -oE '(Missing|missing|No|no) +[A-Z][A-Z0-9_]{2,}(_KEY|_KEYS|_TOKEN|_SECRET|_API|_APPNAME|_PASSWORD|_USER)?( +key)?|[A-Z][A-Z0-9_]{2,}(_KEY|_KEYS|_TOKEN|_SECRET|_API|_APPNAME|_PASSWORD|_USER) +not set' \
            | grep -oE '[A-Z][A-Z0-9_]{2,}(_KEY|_KEYS|_TOKEN|_SECRET|_API|_APPNAME|_PASSWORD|_USER)' | sort -u | paste -sd, -)
    printf "NOKEY (needs %s)\n" "$key"
    nokey=$((nokey + 1))
  # A PREREQUISITE SEEDER IS A DEPENDENCY PROBLEM, NOT A FAILURE. The runner globs
  # seed-*.mjs alphabetically, so seed-climate-anomalies runs BEFORE the
  # seed-climate-zone-normals baseline it requires — a guaranteed nightly failure
  # that ordering alone would fix.
  elif echo "$output" | grep -qiE 'run (node )?scripts/seed-[a-z0-9-]+\.mjs (first|before)'; then
    dep=$(echo "$output" | grep -oE 'scripts/seed-[a-z0-9-]+\.mjs' | head -1)
    printf "DEFERRED (needs %s to run first)\n" "$(basename "$dep")"
    deferred=$((deferred + 1))
  # A MISSING NPM PACKAGE IS A BUILD DEFECT, NOT A DATA FAILURE, and it is the
  # least legible of all of them: node prints the stack trace and then its own
  # version banner, so the LAST line is "Node.js v24.18.0". Reported that way,
  # seed-digest-notifications has spent every night announcing its runtime
  # version instead of the fact that it imports `resend`, which is not in
  # package.json.
  #
  # Named separately because the fix is a one-line dependency add — and because
  # a package absent on EVERY run is not the same event as a feed that failed
  # today. Lumping them together is what let this sit unfixed.
  # A BUNDLE HIDES ITS CHILD'S REASON. Bundles run sections in-process and report
  # only "[Bundle:x] Finished ... failed:1", so every classification below is blind
  # to WHY. seed-bundle-health is the proof: it fails solely because Air-Quality
  # cannot find OPENAQ_API_KEY — a credential decline, the exact thing NOKEY was
  # built to surface — and it was being counted as a generic FAIL anyway.
  #
  # This is the SAME defect a third time: first manual-only scripts, then seeders
  # whose decline was not on the last line, now bundles that swallow the child's
  # message. Each layer re-hid the reason one level up.
  #
  # So classify by the SECTION reasons, not the bundle summary. If every failing
  # section is a credential decline, the bundle is NOKEY like any other seeder;
  # otherwise it stays FAIL but NAMES the sections instead of quoting a count.
  elif echo "$output" | grep -qE '^\[Bundle:[^]]+\] section=.* status=FAILED'; then
    secs=$(echo "$output" | grep -oE 'section=[A-Za-z0-9_-]+ status=FAILED' | sed 's/section=//;s/ status=FAILED//' | paste -sd, -)
    nfail=$(echo "$output" | grep -cE 'section=.* status=FAILED')
      # SCOPE THE COUNT TO THE FAILED SECTIONS' OWN REASONS. Counting declines anywhere
      # in the output let unrelated mentions outvote a genuine failure. The bundle runner
      # now puts the child's decline INTO reason=, so the failing sections can be asked
      # directly whether EVERY one of them declined for a credential.
      failreasons=$(echo "$output" | grep -E '^\[Bundle:[^]]+\] section=.* status=FAILED')
      nkey=$(printf '%s\n' "$failreasons" | grep -cE '(Missing|missing|No|no) +[A-Z][A-Z0-9_]{2,}(_KEY|_KEYS|_TOKEN|_SECRET|_API|_APPNAME|_PASSWORD|_USER)?( +key)?|[A-Z][A-Z0-9_]{2,}(_KEY|_KEYS|_TOKEN|_SECRET|_API|_APPNAME|_PASSWORD|_USER) +(missing|not set)')
    if [ "$nkey" -ge "$nfail" ]; then
        key=$(printf '%s\n' "$failreasons" | grep -oE '[A-Z][A-Z0-9_]{2,}(_KEY|_KEYS|_TOKEN|_SECRET|_API|_APPNAME|_PASSWORD|_USER)' | sort -u | paste -sd, -)
      printf "NOKEY (bundle section %s needs %s)\n" "$secs" "$key"
      nokey=$((nokey + 1))
    else
      printf "FAIL (bundle sections: %s)\n" "$secs"
      fail=$((fail + 1))
    fi
  elif echo "$output" | grep -qE "Cannot find (module|package)|ERR_MODULE_NOT_FOUND"; then
    mod=$(echo "$output" | grep -oE "Cannot find (module|package) '[^']+'" | head -1 | grep -oE "'[^']+'" | tr -d "'")
    printf "DEPFAIL (missing package %s — not in package.json)\n" "${mod:-unknown}"
    depfail=$((depfail + 1))
  elif echo "$last" | grep -qi "skip\|not set\|missing.*key\|not found"; then
    printf "SKIP (%s)\n" "$last"
    skip=$((skip + 1))
  elif [ $rc -eq 0 ]; then
    printf "OK\n"
    ok=$((ok + 1))
  else
    printf "FAIL (%s)\n" "$last"
    fail=$((fail + 1))
  fi
done

echo ""
echo "$(date -u +%FT%TZ) Done: $ok ok, $skip skipped, $fail failed, $timedout timed out, $excluded manual-only, $nokey missing-credential, $deferred dependency-deferred, $depfail missing-package"
