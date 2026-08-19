import type {
  ServerContext,
  GetShippingRatesRequest,
  GetShippingRatesResponse,
} from '../../../../src/generated/server/worldmonitor/supply_chain/v1/service_server';

import { attach } from '../../../_shared/data-status';

const REDIS_CACHE_KEY = 'supply_chain:shipping:v2';

export async function getShippingRates(
  _ctx: ServerContext,
  _req: GetShippingRatesRequest,
): Promise<GetShippingRatesResponse> {
  return attach(REDIS_CACHE_KEY, 'the seeder for get shipping rates has not written this key', (raw) => {
    const result = raw as GetShippingRatesResponse | null;
    return result ?? { indices: [], fetchedAt: new Date().toISOString(), upstreamUnavailable: true };
  });
}
