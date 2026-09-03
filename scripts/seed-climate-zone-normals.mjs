#!/usr/bin/env node

import { loadEnvFile, runSeed, sleep, getRedisCredentials, writeExtraKey } from './_seed-utils.mjs';
import { CLIMATE_ZONES, MIN_CLIMATE_ZONE_COUNT, hasRequiredClimateZones } from './_climate-zones.mjs';
import { chunkItems, fetchOpenMeteoArchiveBatch } from './_open-meteo-archive.mjs';

loadEnvFile(import.meta.url);

export const CLIMATE_ZONE_NORMALS_KEY = 'climate:zone-normals:v1';
// Keep the previous baseline available across monthly cron gaps; health.js enforces freshness separately.
const NORMALS_TTL = 95 * 24 * 60 * 60; // 95 days = >3x a 31-day monthly interval
const NORMALS_START = '1991-01-01';
const NORMALS_END = '2020-12-31';
const NORMALS_BATCH_SIZE = 2;
// 15s, not 3s. Open-Meteo weights a call by days x locations x variables, and each
// batch here is 2 locations x ~11,000 days (the WMO 1991-2020 normals period) x N
// variables — roughly 44 weighted calls apiece. Thirteen of them 3s apart put ~570
// weighted calls inside one minute, against the free tier's ~600/min cap, so the run
// rate-limited itself. Measured 2026-09-03: ONE batch returns HTTP 200 in 1.0s
// (497KB), while the full run logged 93 x HTTP 429 and completed ZERO zones even
// with a 25-minute deadline — so the budget was never the constraint, the rate was.
const NORMALS_BATCH_DELAY_MS = 15_000;

// ── INCREMENTAL ACCUMULATION ────────────────────────────────────────────────
// 1991-2020 normals are STATIC: a zone fetched once is correct forever. There is
// therefore no reason to fetch 25 zones in one burst, and every reason not to —
// Open-Meteo weights a call by days x locations x variables, so a full run is
// ~570 weighted calls against a ~600/min cap and rate-limits itself. Measured
// 2026-09-03: a full run logged 93 x HTTP 429 and completed ZERO zones even with
// a 25-minute deadline, while ONE batch returns HTTP 200 in 1.0s.
//
// So the run accumulates instead of bursting: it fetches at most
// NORMALS_MAX_BATCHES_PER_RUN batches of zones it does not already have, persists
// after EVERY batch, and reports RETRY until the set is complete. A rate-limit or
// a crash now costs one batch, not the whole run, and the monthly cron converges
// in a few cycles. Progress survives because it is written before the run ends.
const NORMALS_PARTIAL_KEY = 'climate:zone-normals:partial:v1';
const NORMALS_PARTIAL_TTL = 180 * 24 * 60 * 60; // 180d — static data; must outlive the monthly cadence
const NORMALS_MAX_BATCHES_PER_RUN = 4; // 4 x 2 zones x ~44 weighted calls, spread 15s apart

async function readPartialNormals() {
  try {
    const { url, token } = getRedisCredentials();
    const resp = await fetch(`${url}/get/${encodeURIComponent(NORMALS_PARTIAL_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const body = await resp.json();
    if (!body?.result) return [];
    const parsed = JSON.parse(body.result);
    const list = Array.isArray(parsed) ? parsed : parsed?.data?.normals ?? parsed?.normals;
    // Only accept fully-formed zones — a half-written entry must not count as done,
    // or a zone silently never gets refetched.
    return Array.isArray(list)
      ? list.filter((z) => z?.zone && Array.isArray(z.months) && z.months.length === 12)
      : [];
  } catch {
    return []; // partial cache is an optimisation; never let it fail the seed
  }
}

async function writePartialNormals(normals) {
  try {
    await writeExtraKey(NORMALS_PARTIAL_KEY, { normals }, NORMALS_PARTIAL_TTL);
    return true;
  } catch (err) {
    console.log(`  [CLIMATE_NORMALS] partial-progress write failed (${err?.message ?? err}) — this run's zones will be refetched`);
    return false;
  }
}

function round(value, decimals = 2) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function computeMonthlyNormals(daily) {
  const dailyBucketByYearMonth = new Map();
  for (let month = 1; month <= 12; month++) {
    dailyBucketByYearMonth.set(month, new Map());
  }

  const times = daily?.time ?? [];
  const temps = daily?.temperature_2m_mean ?? [];
  const precips = daily?.precipitation_sum ?? [];

  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    const temp = temps[i];
    const precip = precips[i];
    if (typeof time !== 'string' || temp == null || precip == null) continue;
    const year = Number(time.slice(0, 4));
    const month = Number(time.slice(5, 7));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const bucket = dailyBucketByYearMonth.get(month);
    const existing = bucket.get(key);
    if (existing) {
      existing.temps.push(Number(temp));
      existing.precips.push(Number(precip));
      continue;
    }
    bucket.set(key, {
      temps: [Number(temp)],
      precips: [Number(precip)],
    });
  }

  return Array.from(dailyBucketByYearMonth.entries())
    .map(([month, bucket]) => {
      const monthlyMeans = Array.from(bucket.values())
        .map((entry) => ({
          tempMean: average(entry.temps),
          precipMean: average(entry.precips),
        }))
        .filter((entry) => Number.isFinite(entry.tempMean) && Number.isFinite(entry.precipMean));

      if (monthlyMeans.length === 0) return null;

      return {
        month,
        tempMean: round(average(monthlyMeans.map((entry) => entry.tempMean))),
        precipMean: round(average(monthlyMeans.map((entry) => entry.precipMean))),
      };
    })
    .filter((entry) => entry != null && Number.isFinite(entry.tempMean) && Number.isFinite(entry.precipMean));
}

export function buildZoneNormalsFromBatch(zones, batchPayloads) {
  return zones.flatMap((zone, index) => {
    const data = batchPayloads[index];
    const months = computeMonthlyNormals(data?.daily);
    if (months.length !== 12) {
      console.warn(`  [CLIMATE_NORMALS] Open-Meteo normals incomplete for ${zone.name}: expected 12 months, got ${months.length}`);
      return [];
    }

    return [{
      zone: zone.name,
      location: { latitude: zone.lat, longitude: zone.lon },
      months,
    }];
  });
}

export async function fetchClimateZoneNormals(opts = {}) {
  const {
    _readPartial = readPartialNormals,
    _writePartial = writePartialNormals,
    _maxBatches = NORMALS_MAX_BATCHES_PER_RUN,
    _fetchBatch = fetchOpenMeteoArchiveBatch,
    _sleep = sleep,
  } = opts;

  // Start from whatever previous runs already proved. Static data, so these
  // never need refetching.
  //
  // COPY, don't alias: this array is pushed into below, and aliasing whatever the
  // reader returned would mutate the caller's own data. Harmless with the default
  // helper (it builds a fresh array) and a real bug with any other reader — it
  // silently made this file's own accumulation test pass a set it had corrupted.
  //
  // The try/catch belongs HERE, not only inside readPartialNormals: the partial
  // cache is an optimisation, and no reader — default or injected — may turn a
  // cache miss into a failed seed.
  let restored = [];
  try {
    restored = await _readPartial();
  } catch (err) {
    console.log(`  [CLIMATE_NORMALS] partial-progress read failed (${err?.message ?? err}) — starting from scratch this run`);
  }
  const normals = Array.isArray(restored) ? [...restored] : [];
  const have = new Set(normals.map((z) => z.zone));
  const todo = CLIMATE_ZONES.filter((z) => !have.has(z.name));
  if (normals.length) {
    console.log(`  [CLIMATE_NORMALS] resuming with ${normals.length}/${CLIMATE_ZONES.length} zones already accumulated; ${todo.length} to go`);
  }

  let failures = 0;
  let batchesRun = 0;

  for (const batch of chunkItems(todo, NORMALS_BATCH_SIZE)) {
    if (batchesRun >= _maxBatches) {
      console.log(`  [CLIMATE_NORMALS] per-run cap of ${_maxBatches} batches reached — ${todo.length - batchesRun * NORMALS_BATCH_SIZE} zone(s) deferred to the next run`);
      break;
    }
    batchesRun += 1;
    try {
      const payloads = await _fetchBatch(batch, {
        startDate: NORMALS_START,
        endDate: NORMALS_END,
        daily: ['temperature_2m_mean', 'precipitation_sum'],
        timeoutMs: 30_000,
        maxRetries: 4,
        retryBaseMs: 5_000,
        label: `normals batch (${batch.map((zone) => zone.name).join(', ')})`,
      });
      const batchNormals = buildZoneNormalsFromBatch(batch, payloads);
      normals.push(...batchNormals);
      failures += Math.max(0, batch.length - batchNormals.length);
      // Persist after EVERY batch. This is the whole point: a 429 or a crash on
      // the next batch must cost one batch, not the accumulated set.
      if (batchNormals.length) await _writePartial(normals);
    } catch (err) {
      console.log(`  [CLIMATE_NORMALS] ${err?.message ?? err}`);
      failures += batch.length;
    }
    await _sleep(NORMALS_BATCH_DELAY_MS);
  }

  if (normals.length < MIN_CLIMATE_ZONE_COUNT) {
    // Not a failure of this run so much as a partial one — say so precisely, and
    // name what was banked, so a reader can tell "converging" from "stuck".
    throw new Error(
      `Accumulated ${normals.length}/${CLIMATE_ZONES.length} zones (need ${MIN_CLIMATE_ZONE_COUNT}); `
      + `${failures} error(s) this run. Progress is persisted — the next run resumes from here.`
    );
  }
  if (!hasRequiredClimateZones(normals, (zone) => zone.zone)) {
    throw new Error('Missing one or more required climate-specific zone normals');
  }

  return {
    referencePeriod: '1991-2020',
    fetchedAt: Date.now(),
    normals,
  };
}

function validate(data) {
  return Array.isArray(data?.normals)
    && data.normals.length >= MIN_CLIMATE_ZONE_COUNT
    && hasRequiredClimateZones(data.normals, (zone) => zone.zone)
    && data.normals.every((zone) => Array.isArray(zone?.months) && zone.months.length === 12);
}

// Contract opt-in: records = number of climate zones with 1991-2020 normals.
// Custom shape `{referencePeriod, fetchedAt, normals[]}` — computeRecordCount
// auto-detect historically missed this, causing the phantom EMPTY_DATA symptom
// documented in the plan's discrepancy class 1.
export function declareRecords(data) {
  return Array.isArray(data?.normals) ? data.normals.length : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''));
if (isMain) {
  runSeed('climate', 'zone-normals', CLIMATE_ZONE_NORMALS_KEY, fetchClimateZoneNormals, {
    // 13 batches x (1s request + 15s spacing) is ~210s, and the inherited default is
    // lockTtlMs + margin = 240s — too tight to absorb even one retry. Sized explicitly
    // from the measurement above rather than inherited from an unrelated default.
    fetchPhaseTimeoutMs: 600_000,
    validateFn: validate,
    ttlSeconds: NORMALS_TTL,
    sourceVersion: 'open-meteo-wmo-1991-2020-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 89280, // matches api/health.js SEED_META (monthly cron on 1st; 62d window)
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
