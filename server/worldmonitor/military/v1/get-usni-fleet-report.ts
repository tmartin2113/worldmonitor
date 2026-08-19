import type {
  ServerContext,
  GetUSNIFleetReportRequest,
  GetUSNIFleetReportResponse,
  USNIFleetReport,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';

import { readSeeded } from '../../../_shared/data-status';

const USNI_CACHE_KEY = 'usni-fleet:sebuf:v1';
const USNI_STALE_CACHE_KEY = 'usni-fleet:sebuf:stale:v1';

export function buildUSNIFleetReportForceRefreshResponse(): GetUSNIFleetReportResponse {
  return {
    report: undefined,
    cached: false,
    stale: false,
    error: 'forceRefresh is no longer supported (data is seeded by Railway relay)',
  };
}

export function buildUSNIFleetReportCacheResponse(
  report: USNIFleetReport | null,
  stale: USNIFleetReport | null,
): GetUSNIFleetReportResponse {
  if (report) {
    return { report, cached: true, stale: false, error: '' };
  }

  if (stale) {
    return { report: stale, cached: true, stale: true, error: 'Using cached data' };
  }

  return {
    report: undefined,
    cached: false,
    stale: false,
    error: 'No USNI fleet data in cache (waiting for seed)',
  };
}

// ========================================================================
// RPC handler (Redis-read-only — Railway relay seeds the data)
// ========================================================================

export async function getUSNIFleetReport(
  _ctx: ServerContext,
  req: GetUSNIFleetReportRequest,
): Promise<GetUSNIFleetReportResponse> {
  if (req.forceRefresh) {
    return buildUSNIFleetReportForceRefreshResponse();
  }

  // A cascade, not a composite: the stale key answers the same question as the
  // live one, so falling back means the answer is OLD, not incomplete.
  const live = await readSeeded<USNIFleetReport>(USNI_CACHE_KEY,
    'the USNI fleet-report seeder has not written the live key');
  if (live.status.availability === 'DATA_AVAILABILITY_UPSTREAM_ERROR') {
    return { report: undefined, cached: false, stale: false, error: live.status.detail, dataStatus: live.status };
  }
  if (live.data) {
    return { ...buildUSNIFleetReportCacheResponse(live.data, null), dataStatus: live.status };
  }

  const stale = await readSeeded<USNIFleetReport>(USNI_STALE_CACHE_KEY, 'no stale USNI snapshot either');
  return {
    ...buildUSNIFleetReportCacheResponse(null, stale.data),
    dataStatus: stale.data
      ? { fetchedAt: stale.status.fetchedAt, availability: 'DATA_AVAILABILITY_STALE',
          detail: 'the live USNI report was unavailable; serving the stale snapshot' }
      : { fetchedAt: '0', availability: 'DATA_AVAILABILITY_NEVER_SEEDED',
          detail: 'neither the live nor the stale USNI fleet report has been written' },
  };
}
