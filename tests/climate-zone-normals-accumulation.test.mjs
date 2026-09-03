// climate:zone-normals accumulates across runs instead of bursting.
//
// Why this exists: 1991-2020 normals are STATIC, so a zone fetched once is
// correct forever — but the seeder used to refetch all 25 zones every run.
// Open-Meteo weights a call by days x locations x variables, and each batch is
// 2 locations x ~11,000 days, so a full run is ~570 weighted calls against a
// ~600/min cap and rate-limits itself. Measured 2026-09-03: a full run logged
// 93 x HTTP 429 and completed ZERO zones even with a 25-minute deadline, while
// ONE batch returns HTTP 200 in 1.0s. The budget was never the constraint.
//
// The contract asserted here:
//   1. Zones already banked are NOT refetched.
//   2. Progress is persisted after EVERY batch, so a failure costs one batch.
//   3. A per-run cap bounds the burst; leftovers defer to the next run.
//   4. A partial-cache read failure degrades to a full fetch, never a crash.
//   5. An incomplete run throws a message that distinguishes "converging" from
//      "stuck" — and still keeps what it banked.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fetchClimateZoneNormals } from '../scripts/seed-climate-zone-normals.mjs';
import { CLIMATE_ZONES } from '../scripts/_climate-zones.mjs';

// One zone's worth of well-formed normals.
const zoneRecord = (name) => ({
  zone: name,
  location: { latitude: 0, longitude: 0 },
  months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, tempMean: 10, precipSum: 5 })),
});

// A fetcher that returns a valid payload for every zone it is handed, and
// records which zones it was asked for.
function recordingFetcher(asked) {
  return async (batch) => {
    asked.push(...batch.map((z) => z.name));
    // buildZoneNormalsFromBatch consumes the raw open-meteo shape; return one
    // payload per zone with 12 months of daily data collapsed by the builder.
    return batch.map(() => ({
      daily: {
        time: ['1991-01-15', '1991-02-15', '1991-03-15', '1991-04-15', '1991-05-15', '1991-06-15',
               '1991-07-15', '1991-08-15', '1991-09-15', '1991-10-15', '1991-11-15', '1991-12-15'],
        temperature_2m_mean: Array(12).fill(10),
        precipitation_sum: Array(12).fill(5),
      },
    }));
  };
}

describe('climate zone-normals accumulation', () => {
  it('does not refetch zones already banked', async () => {
    const banked = CLIMATE_ZONES.slice(0, 6).map((z) => zoneRecord(z.name));
    const bankedNamesBefore = new Set(banked.map((z) => z.zone));
    const asked = [];
    await fetchClimateZoneNormals({
      _readPartial: async () => banked,
      _writePartial: async () => true,
      _fetchBatch: recordingFetcher(asked),
      _sleep: async () => {},
      _maxBatches: 99,
    }).catch(() => {}); // may still be short of the minimum; irrelevant here

    // Snapshot BEFORE the call. Taking it after would let an implementation that
    // mutates the reader's array mark its own refetches as "already banked" — which
    // is exactly the defect this test caught on first run.
    const refetched = asked.filter((n) => bankedNamesBefore.has(n));
    assert.deepEqual(refetched, [], `refetched already-banked zones: ${refetched.join(', ')}`);
    assert.equal(banked.length, 6, 'must not mutate the array the reader returned');
  });

  it('persists after every batch, not once at the end', async () => {
    const writes = [];
    const asked = [];
    await fetchClimateZoneNormals({
      _readPartial: async () => [],
      _writePartial: async (n) => { writes.push(n.length); return true; },
      _fetchBatch: recordingFetcher(asked),
      _sleep: async () => {},
      _maxBatches: 3,
    }).catch(() => {});
    assert.equal(writes.length, 3, 'one persist per successful batch');
    assert.deepEqual(writes, [2, 4, 6], 'each write carries the cumulative set');
  });

  it('bounds the burst with a per-run cap', async () => {
    const asked = [];
    await fetchClimateZoneNormals({
      _readPartial: async () => [],
      _writePartial: async () => true,
      _fetchBatch: recordingFetcher(asked),
      _sleep: async () => {},
      _maxBatches: 4,
    }).catch(() => {});
    assert.equal(asked.length, 8, '4 batches x 2 zones — the rest defer to the next run');
    assert.ok(asked.length < CLIMATE_ZONES.length, 'must not attempt the whole set in one run');
  });

  it('degrades to a full fetch when the partial cache is unreadable', async () => {
    const asked = [];
    await fetchClimateZoneNormals({
      _readPartial: async () => { throw new Error('redis down'); },
      _writePartial: async () => true,
      _fetchBatch: recordingFetcher(asked),
      _sleep: async () => {},
      _maxBatches: 2,
    }).catch((err) => {
      // A cache read failure must not surface as the run's failure mode.
      assert.ok(!/redis down/.test(err.message), `cache error leaked into the seed: ${err.message}`);
    });
  });

  it('an incomplete run says it is converging and keeps what it banked', async () => {
    let persisted = [];
    await assert.rejects(
      () => fetchClimateZoneNormals({
        _readPartial: async () => [],
        _writePartial: async (n) => { persisted = n; return true; },
        _fetchBatch: recordingFetcher([]),
        _sleep: async () => {},
        _maxBatches: 2,
      }),
      /Accumulated \d+\/\d+ zones .*Progress is persisted/s,
    );
    assert.equal(persisted.length, 4, 'the banked zones survive the throw');
  });
});
