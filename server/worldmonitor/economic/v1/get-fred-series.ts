/**
 * RPC: getFredSeries -- reads seeded FRED time series data from Railway seed cache.
 * All external FRED API calls happen in seed-economy.mjs on Railway.
 */

import type {
  ServerContext,
  GetFredSeriesRequest,
  GetFredSeriesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { readSeeded, withCount } from '../../../_shared/data-status';
import { applyFredObservationLimit, fredSeedKey, normalizeFredLimit } from './_fred-shared';

export async function getFredSeries(
  _ctx: ServerContext,
  req: GetFredSeriesRequest,
): Promise<GetFredSeriesResponse> {
  if (!req.seriesId) {
    return { series: undefined, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no series_id supplied' } };
  }
  const read = await readSeeded<GetFredSeriesResponse>(
    fredSeedKey(req.seriesId),
    'seed-economy.mjs has not written this FRED series (it requires FRED_API_KEY). This is not FRED reporting no such series.',
  );
  if (!read.data?.series) {
    return { series: undefined, dataStatus: withCount(read.status, 0) };
  }
  const limit = normalizeFredLimit(req.limit);
  const series = applyFredObservationLimit(read.data.series, limit);
  return { series, dataStatus: withCount(read.status, series.observations?.length ?? 0) };
}
