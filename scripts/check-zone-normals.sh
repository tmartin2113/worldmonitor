#!/usr/bin/env bash
# Verdict on climate:zone-normals accumulation — one command, no guessing.
#
# Context: the seeder used to refetch all 25 WMO 1991-2020 zones every run, which
# is ~570 weighted Open-Meteo calls against a ~600/min cap, so it rate-limited
# itself into completing nothing (measured 2026-09-03: 93 x HTTP 429, ZERO zones,
# even with a 25-minute deadline). It now resumes from a persisted partial set,
# takes at most 4 batches per run, and persists after every batch.
#
# That change could not be verified the day it was written, because three
# diagnostic runs had already spent that day's weighted quota. This script is the
# retest. Run it any time after a daily 04:00 sweep.
#
# Reports NUMBERS, not adjectives: banked zone count, whether the canonical key
# exists, what seed-health says, and the 429 count from the most recent run — so
# "converging", "done" and "still rate-limited" are distinguishable at a glance.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${WM_APP:-http://127.0.0.1:3300}"
TOTAL_ZONES=25
MIN_ZONES=17

echo "climate:zone-normals — accumulation verdict  ($(date '+%F %H:%M %Z'))"
echo "============================================================"

# ── 1. What seed-health says (authoritative for the panel) ──────────────────
CJ="$(mktemp)"; trap 'rm -f "$CJ"' EXIT
curl -s -c "$CJ" -m 10 -X POST "$APP/api/wm-session" -o /dev/null 2>/dev/null
SH="$(curl -s -b "$CJ" -m 30 "$APP/api/seed-health" 2>/dev/null)"
if [ -z "$SH" ]; then
  echo "  seed-health: UNREACHABLE at $APP — cannot judge; is the container up?"
  exit 2
fi
status="$(printf '%s' "$SH" | python3 -c "
import sys,json
try: d=json.load(sys.stdin)['seeds'].get('climate:zone-normals') or {}
except Exception: d={}
print(d.get('status','<absent>'), d.get('ageMinutes','?'), d.get('recordCount','?'))
" 2>/dev/null)"
set -- $status
echo "  seed-health status : ${1:-?}   age=${2:-?}min  records=${3:-?}"

# ── 2. Banked progress (the thing the fix added) ────────────────────────────
BANKED="$(cd "$DIR" && node -e "
import('./scripts/_seed-utils.mjs').then(async (u) => {
  try {
    // loadEnvFile FIRST — getRedisCredentials reads process.env, which is empty
    // in a bare node -e context. Without this the check reports '?' and looks
    // like a redis outage when nothing is wrong.
    u.loadEnvFile(new URL('./scripts/_seed-utils.mjs', 'file://' + process.cwd() + '/').href);
    const { url, token } = u.getRedisCredentials();
    const r = await fetch(url + '/get/' + encodeURIComponent('climate:zone-normals:partial:v1'),
      { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
    const b = await r.json();
    if (!b?.result) return console.log('0');
    const p = JSON.parse(b.result);
    const list = Array.isArray(p) ? p : (p?.data?.normals ?? p?.normals ?? []);
    console.log(String(list.filter(z => z?.zone && z?.months?.length === 12).length));
  } catch { console.log('?'); }
});" 2>/dev/null | tail -1)"
echo "  zones banked       : ${BANKED:-?} / $TOTAL_ZONES   (need $MIN_ZONES to publish)"

# ── 3. Rate-limit pressure on the most recent attempt ───────────────────────
LOG="$DIR/seeder-cron.log"
if [ -f "$LOG" ]; then
  last429="$(grep -c 'HTTP 429' "$LOG" 2>/dev/null || true)"
  last429="${last429:-0}"
  echo "  429s in sweep log  : $last429  (cumulative; 0 on a clean day)"
fi

# ── 4. The verdict — stated as a state, with the next action ────────────────
echo "------------------------------------------------------------"
case "${BANKED:-?}" in
  ''|'?')      echo "  UNKNOWN — could not read the partial key (redis creds or network)."; exit 2;;
  0)           echo "  NOT STARTED — nothing banked. If 429s are high the quota is still"
               echo "  spent; if they are 0 the seeder did not run. Check the sweep log."; exit 1;;
esac
if [ "$BANKED" -ge "$TOTAL_ZONES" ] 2>/dev/null; then
  echo "  COMPLETE — all $TOTAL_ZONES zones banked. climate:anomalies is unblocked."
  exit 0
elif [ "$BANKED" -ge "$MIN_ZONES" ] 2>/dev/null; then
  echo "  PUBLISHABLE — $BANKED zones, at or above the $MIN_ZONES minimum."
  echo "  Remaining zones fill in on subsequent runs."
  exit 0
else
  echo "  CONVERGING — $BANKED/$TOTAL_ZONES banked, below the $MIN_ZONES minimum."
  echo "  This is the DESIGNED state mid-accumulation, not a failure: each run adds"
  echo "  up to 8 zones and keeps them. Expect completion within a few daily sweeps."
  echo "  It is only wrong if this number does not move between runs."
  exit 0
fi
