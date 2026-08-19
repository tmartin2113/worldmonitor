/**
 * RPC: getFredSeriesBatch -- reads seeded FRED data from Railway seed cache.
 * All external FRED API calls happen in seed-economy.mjs on Railway.
 */

import type {
  ServerContext,
  GetFredSeriesBatchRequest,
  GetFredSeriesBatchResponse,
  FredSeries,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { getCachedJsonBatch } from '../../../_shared/redis';
import { upstreamError } from '../../../_shared/data-status';
import { toUniqueSortedLimited } from '../../../_shared/normalize-list';
import { applyFredObservationLimit, fredSeedKey, normalizeFredLimit } from './_fred-shared';

const ALLOWED_SERIES = new Set<string>([
  'WALCL', 'FEDFUNDS', 'T10Y2Y', 'UNRATE', 'CPIAUCSL', 'DGS10', 'VIXCLS',
  'GDP', 'M2SL', 'DCOILWTICO', 'BAMLH0A0HYM2', 'ICSA', 'MORTGAGE30US',
  'GSCPI', // NY Fed Global Supply Chain Pressure Index (seeded by ais-relay, not FRED API)
  'T10Y3M', 'STLFSI4', // Economic Stress Index components (seeded by seed-economy.mjs)
  'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS5', 'DGS30', // yield curve tenors
  'BAMLC0A0CM', 'SOFR', // IG OAS spread + Secured Overnight Financing Rate (seeded by seed-economy.mjs)
  'ESTR', 'EURIBOR3M', 'EURIBOR6M', 'EURIBOR1Y', // ECB short rates (seeded by seed-ecb-short-rates.mjs)
]);

export async function getFredSeriesBatch(
  _ctx: ServerContext,
  req: GetFredSeriesBatchRequest,
): Promise<GetFredSeriesBatchResponse> {
  try {
    const normalized = req.seriesIds
      .map((id) => id.trim().toUpperCase())
      .filter((id) => ALLOWED_SERIES.has(id));
    const limitedList = toUniqueSortedLimited(normalized, 20);
    const limit = normalizeFredLimit(req.limit);

    const keysById = new Map(limitedList.map((id) => [id, fredSeedKey(id)]));
    const cachedByKey = await getCachedJsonBatch([...keysById.values()], true);

    const results: Record<string, FredSeries> = {};
    for (const id of limitedList) {
      const cached = cachedByKey.get(keysById.get(id)!) as { series?: FredSeries } | undefined;
      if (cached?.series) results[id] = applyFredObservationLimit(cached.series, limit);
    }

    // This handler already counted fetched-vs-requested; PARTIAL is the word for
    // the gap. Every absent series here is one seed-economy.mjs could not write
    // without FRED_API_KEY, which is a provisioning gap, not FRED having no data.
    const fetched = Object.keys(results).length;
    const missing = limitedList.filter((id) => !results[id]);
    const shown = missing.length <= 5 ? missing.join(', ') : `${missing.slice(0, 5).join(', ')} and ${missing.length - 5} more`;
    return {
      results,
      fetched,
      requested: limitedList.length,
      dataStatus: limitedList.length === 0
        ? { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no recognised series_ids requested; nothing was looked up' }
        : fetched === 0
          ? { fetchedAt: '0', availability: 'DATA_AVAILABILITY_NEVER_SEEDED',
              detail: `none of the ${limitedList.length} requested FRED series has been written (seed-economy.mjs requires FRED_API_KEY)` }
          : missing.length
            ? { fetchedAt: '0', availability: 'DATA_AVAILABILITY_PARTIAL',
                detail: `${missing.length} of ${limitedList.length} series missing (${shown}); the rest were read normally` }
            : { fetchedAt: '0', availability: 'DATA_AVAILABILITY_OK', detail: '' },
    };
  } catch (err) {
    return { results: {}, fetched: 0, requested: 0, dataStatus: upstreamError(err, 'FRED batch read failed') };
  }
}
