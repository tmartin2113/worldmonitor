/**
 * ListInternetTrafficAnomalies RPC -- reads seeded traffic anomaly data from Railway seed cache.
 * All external Cloudflare Radar API calls happen in seed-internet-outages.mjs on Railway.
 */

import type {
  ServerContext,
  ListInternetTrafficAnomaliesRequest,
  ListInternetTrafficAnomaliesResponse,
  TrafficAnomaly,
} from '../../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'cf:radar:traffic-anomalies:v1';

export async function listInternetTrafficAnomalies(
  _ctx: ServerContext,
  req: ListInternetTrafficAnomaliesRequest,
): Promise<ListInternetTrafficAnomaliesResponse> {
  return attach(SEED_CACHE_KEY, 'the Cloudflare Radar traffic-anomaly seeder has not written this key', (raw) => {
    const data = raw as ListInternetTrafficAnomaliesResponse | null;
    let anomalies: TrafficAnomaly[] = data?.anomalies || [];

    if (req.country) {
      const target = req.country.toUpperCase();
      anomalies = anomalies.filter((a) => a.locationCode === target);
    }

    return { anomalies, totalCount: anomalies.length };
  }, (out) => out.anomalies.length);
}
