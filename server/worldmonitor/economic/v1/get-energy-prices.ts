/**
 * RPC: getEnergyPrices -- reads seeded energy price data from Railway seed cache.
 * All external EIA API calls happen in seed-economy.mjs on Railway.
 */

import type {
  ServerContext,
  GetEnergyPricesRequest,
  GetEnergyPricesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { readSeeded, withCount } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:energy:v1:all';

export async function getEnergyPrices(
  _ctx: ServerContext,
  req: GetEnergyPricesRequest,
): Promise<GetEnergyPricesResponse> {
  const read = await readSeeded<GetEnergyPricesResponse>(
    SEED_CACHE_KEY,
    'seed-economy.mjs has not written energy prices (the EIA series requires EIA_API_KEY).',
  );
  let prices = read.data?.prices ?? [];
  if (req.commodities.length > 0) {
    prices = prices.filter(p => req.commodities.includes(p.commodity));
  }
  return { prices, dataStatus: withCount(read.status, prices.length) };
}
