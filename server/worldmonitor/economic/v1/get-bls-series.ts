/**
 * RPC: getBlsSeries -- reads seeded BLS time series from Railway seed cache.
 * All external BLS API calls happen in scripts/seed-bls-series.mjs on Railway.
 */
import type {
  ServerContext,
  GetBlsSeriesRequest,
  GetBlsSeriesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';
import filterParamContracts from '../../../../shared/openapi-filter-param-contracts.json';
import { readSeeded, withCount } from '../../../_shared/data-status';

const BLS_KEY_PREFIX = 'bls:series';

// Only allow series IDs that were seeded. Prevents unbounded Redis key enumeration.
// National series now fetched via FRED (api.bls.gov is blocked from Railway IPs).
// Metro-area LAUMT* series dropped — no FRED equivalent available.
const KNOWN_SERIES_IDS = new Set(filterParamContracts.economicBlsSeriesIds);

function normalizeLimit(limit: number): number {
  return limit > 0 ? Math.min(limit, 500) : 60;
}

export async function getBlsSeries(
  _ctx: ServerContext,
  req: GetBlsSeriesRequest,
): Promise<GetBlsSeriesResponse> {
  // A rejected request is answered, not empty: the caller asked for something
  // this endpoint does not serve, which is different from having no data.
  if (!req.seriesId) {
    return { series: undefined, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no series_id supplied' } };
  }
  if (!KNOWN_SERIES_IDS.has(req.seriesId)) {
    return { series: undefined, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: `series_id is not one of the seeded BLS series; nothing was looked up` } };
  }

  const read = await readSeeded<GetBlsSeriesResponse>(
    `${BLS_KEY_PREFIX}:${req.seriesId}`,
    'seed-bls-series.mjs has not written this series (it sources via FRED and needs FRED_API_KEY; api.bls.gov is blocked from Railway IPs).',
  );
  if (!read.data?.series) {
    return { series: undefined, dataStatus: withCount(read.status, 0) };
  }

  const limit = normalizeLimit(req.limit);
  const obs = read.data.series.observations;
  const sliced = obs.length > limit ? obs.slice(-limit) : obs;

  return {
    series: { ...read.data.series, observations: sliced },
    dataStatus: withCount(read.status, sliced.length),
  };
}
