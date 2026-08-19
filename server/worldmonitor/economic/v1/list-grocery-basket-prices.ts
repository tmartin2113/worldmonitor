/**
 * RPC: listGroceryBasketPrices -- reads seeded grocery basket data from Railway seed cache.
 * All EXA API calls happen in seed-grocery-basket.mjs on Railway.
 */

import type {
  ServerContext,
  ListGroceryBasketPricesRequest,
  ListGroceryBasketPricesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:grocery-basket:v1';

export async function listGroceryBasketPrices(
  _ctx: ServerContext,
  _req: ListGroceryBasketPricesRequest,
): Promise<ListGroceryBasketPricesResponse> {
  return attach(SEED_CACHE_KEY, 'the grocery-basket seeder has not written this key', (raw) => {
    const result = raw as ListGroceryBasketPricesResponse | null;
    if (!result?.countries?.length) {
      return { countries: [], fetchedAt: '', cheapestCountry: '', mostExpensiveCountry: '', upstreamUnavailable: true, wowAvgPct: 0, wowAvailable: false, prevFetchedAt: '' };
    }
    return result;
  }, (out) => out.countries.length);
}
