/**
 * RPC: ListStablecoinMarkets -- reads seeded stablecoin data from Railway seed cache.
 * All external CoinGecko calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListStablecoinMarketsRequest,
  ListStablecoinMarketsResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'market:stablecoins:v1';

const EMPTY_RESPONSE: ListStablecoinMarketsResponse = {
  timestamp: new Date().toISOString(),
  summary: {
    totalMarketCap: 0,
    totalVolume24h: 0,
    coinCount: 0,
    depeggedCount: 0,
    healthStatus: 'UNAVAILABLE',
  },
  stablecoins: [],
};

export async function listStablecoinMarkets(
  _ctx: ServerContext,
  _req: ListStablecoinMarketsRequest,
): Promise<ListStablecoinMarketsResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for list stablecoin markets has not written this key', (raw) => {
    const seedData = raw as ListStablecoinMarketsResponse | null;
    return seedData || EMPTY_RESPONSE;
  });
}
