#!/bin/sh
# Run one tier of seeders. Reports a per-run summary so a tier that starts
# failing is visible in the log rather than silently doing nothing.
set -u
TIER="${1:?usage: run-tier.sh <fast|hourly>}"
DIR=/home/prime/tool-integrations/worldmonitor
LIST="$DIR/scripts/tier-$TIER.txt"
[ -f "$LIST" ] || { echo "$(date -u +%FT%TZ) tier list missing: $LIST"; exit 1; }
export PATH="/home/prime/.nvm/versions/node/v24.18.0/bin:$PATH"
if [ -f "$DIR/.env" ]; then set -a; . "$DIR/.env"; set +a; fi
export UPSTASH_REDIS_REST_URL="${UPSTASH_REDIS_REST_URL:-http://localhost:8079}"
[ -n "${REDIS_TOKEN:-}" ] && export UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"
[ -n "${UPSTASH_REDIS_REST_TOKEN:-}" ] || { echo "$(date -u +%FT%TZ) $TIER: no redis token"; exit 1; }
cd "$DIR" || exit 1
# PER-TIER CAP, one place so the failure message cannot drift from the cap.
# A flat 60s made seed-recall-benchmark fail ~40% of FAST-tier passes: it exits in
# 0s when there is no digest to benchmark and needs longer when there is, so the
# same seeder looked both fast and broken. A tier logging FAILED every 15 minutes
# trains its reader to ignore the log — the alert-fatigue failure this stack keeps
# rediscovering. Fast stays tight (it runs 96x/day); hourly gets room to finish.
# The cap must EXCEED the seeder's own internal budget, so the script's graceful
# deadline fires first and it exits having written partial results — rather than
# the tier SIGKILLing it mid-write. seed-recall-benchmark carries
# GDELT_DEADLINE_MS = 4 min; it was in the 60s fast tier, so it was killed at a
# quarter of its designed budget and logged FAILED on 69 of 172 passes. It was
# never hanging. 300s leaves it a minute of headroom over its own 240s deadline.
case "$TIER" in fast) _cap=60;; hourly) _cap=300;; *) _cap=120;; esac
SEED_CAP="${SEED_CAP:-$_cap}"
ok=0; bad=0; noop=0; failed_names=""; noop_names=""; t0=$(date +%s)
OUT=$(mktemp) || exit 1
trap 'rm -f "$OUT"' EXIT INT TERM
while IFS= read -r s; do
  [ -n "$s" ] || continue
  # NAME the failures. "failed=1" without a name is unactionable: the first
  # occurrence looked like a broken seeder and was in fact the 60s cap being hit
  # under load — all 74 pass when run directly. Distinguishing "this seeder is
  # broken" from "this run was slow" needs the name and the exit code.
  #
  # EXIT 0 IS NOT SUCCESS. This loop used to count any zero exit as ok and send
  # stdout to /dev/null. An audit on 2026-08-18 found seed-unrest-events and
  # seed-thermal-escalation had been counted ok on all 346 tier runs while
  # writing NOTHING: they exit 0 in ~30ms printing "Done (26ms, RETRY)" because
  # the upstream keys their bundle depends on are missing. A tier log reading
  # "ok=73 failed=0" was describing a tier with two permanently dead seeders.
  #
  # The seeders already publish the signal we need and it was being discarded:
  # a real write emits a seed_complete event carrying recordCount. So classify
  # on OUTPUT, not just exit code, and count the three outcomes separately —
  # merging no-op into ok is what made the dead ones invisible.
  if timeout "$SEED_CAP" node "scripts/$s.mjs" > "$OUT" 2>&1; then
    if grep -q '"event":"seed_complete"' "$OUT"; then
      # Wrote something. recordCount 0 with skipped=false is still a no-op.
      if grep -q '"recordCount":0[,}]' "$OUT" && ! grep -q '"skipped":true' "$OUT"; then
        noop=$((noop+1)); noop_names="$noop_names $s(0records)"
      else
        ok=$((ok+1))
      fi
    elif grep -q 'RETRY' "$OUT"; then
      # The bundle deliberately declined to write and will retry. Legitimate
      # behaviour, but it is NOT a successful seed and must not be counted as one.
      noop=$((noop+1)); noop_names="$noop_names $s(RETRY)"
    elif grep -qE 'failed:[1-9]' "$OUT"; then
      # EXIT 0 WITH FAILED SECTIONS IS STILL A FAILURE. The sibling harness
      # run-seeders.sh classified bundle summaries by grepping for "skip", and
      # "skipped:2 ... failed:3" matched — 9 of 27 SKIPs were hiding 11 dead
      # sections. Tiers do not currently carry bundle seeders, so this is
      # symmetry rather than an observed bug here: test the NUMBERS before any
      # keyword, in every harness, so the two cannot drift apart again.
      bad=$((bad+1)); failed_names="$failed_names $s(sections)"
    elif grep -qi 'already active\|already running\|lock' "$OUT"; then
      # A concurrent run holds the lock. Genuinely did nothing, but for a benign
      # and self-correcting reason — distinct from a dead seeder, so label it as
      # such rather than lumping it into "silent".
      noop=$((noop+1)); noop_names="$noop_names $s(LOCKED)"
    elif grep -qi 'skip' "$OUT"; then
      noop=$((noop+1)); noop_names="$noop_names $s(SKIP)"
    else
      # Exited clean and said nothing recognisable. Not provably a success.
      noop=$((noop+1)); noop_names="$noop_names $s(silent)"
    fi
  else
    rc=$?
    bad=$((bad+1))
    case $rc in
      124) failed_names="$failed_names $s(TIMEOUT${SEED_CAP}s)" ;;
      *)   failed_names="$failed_names $s(exit$rc)" ;;
    esac
  fi
done < "$LIST"
# ALWAYS log the counts. A tier silently failing every seeder and a tier with
# nothing to do produce identical silence otherwise. noop is reported separately
# from ok on purpose: a rising noop count is the early warning that used to be
# invisible.
echo "$(date -u +%FT%TZ) tier=$TIER ok=$ok noop=$noop failed=$bad elapsed=$(( $(date +%s)-t0 ))s${noop_names:+  NOOP:$noop_names}${failed_names:+  FAILED:$failed_names}"
