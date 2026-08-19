/**
 * RPC: getFaoFoodPriceIndex -- reads seeded FAO FFPI data from Railway seed cache.
 * All data fetching happens in seed-fao-food-price-index.mjs on Railway.
 */

import type {
  ServerContext,
  GetFaoFoodPriceIndexRequest,
  GetFaoFoodPriceIndexResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:fao-ffpi:v1';

const EMPTY: GetFaoFoodPriceIndexResponse = {
  points: [],
  fetchedAt: '',
  currentFfpi: 0,
  momPct: 0,
  yoyPct: 0,
};

export async function getFaoFoodPriceIndex(
  _ctx: ServerContext,
  _req: GetFaoFoodPriceIndexRequest,
): Promise<GetFaoFoodPriceIndexResponse> {
  return attach(SEED_CACHE_KEY, 'the FAO food-price seeder has not written this key', (raw) => {
    const result = raw as GetFaoFoodPriceIndexResponse | null;
    if (!result?.points?.length) return EMPTY;
    return result;
  }, (out) => out.points?.length ?? 0);
}
