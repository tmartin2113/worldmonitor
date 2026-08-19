/**
 * ListInternetDdosAttacks RPC -- reads seeded DDoS summary data from Railway seed cache.
 * All external Cloudflare Radar API calls happen in seed-internet-outages.mjs on Railway.
 */

import type {
  ServerContext,
  ListInternetDdosAttacksRequest,
  ListInternetDdosAttacksResponse,
} from '../../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'cf:radar:ddos:v1';

export async function listInternetDdosAttacks(
  _ctx: ServerContext,
  _req: ListInternetDdosAttacksRequest,
): Promise<ListInternetDdosAttacksResponse> {
  return attach(SEED_CACHE_KEY, 'the Cloudflare Radar DDoS seeder has not written this key', (raw) => {
    const data = raw as ListInternetDdosAttacksResponse | null;
    return {
      protocol: data?.protocol || [],
      vector: data?.vector || [],
      dateRangeStart: data?.dateRangeStart || '',
      dateRangeEnd: data?.dateRangeEnd || '',
      topTargetLocations: data?.topTargetLocations || [],
    };
  }, (out) => out.protocol.length + out.vector.length);
}
