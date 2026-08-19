/**
 * RPC: listBigMacPrices -- reads seeded Big Mac Index data from Railway seed cache.
 * All EXA API calls happen in seed-bigmac.mjs on Railway.
 */

import type {
  ServerContext,
  ListBigMacPricesRequest,
  ListBigMacPricesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:bigmac:v1';

export async function listBigMacPrices(
  _ctx: ServerContext,
  _req: ListBigMacPricesRequest,
): Promise<ListBigMacPricesResponse> {
  return attach(SEED_CACHE_KEY, 'the Big Mac index seeder has not written this key', (raw) => {
    const result = raw as ListBigMacPricesResponse | null;
    if (!result?.countries?.length) {
      return { countries: [], fetchedAt: '', cheapestCountry: '', mostExpensiveCountry: '', wowAvgPct: 0, wowAvailable: false, prevFetchedAt: '' };
    }
    return result;
  }, (out) => out.countries.length);
}
