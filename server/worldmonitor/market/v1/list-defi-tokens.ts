/**
 * RPC: ListDefiTokens -- reads seeded DeFi token data from Railway seed cache.
 */

import type {
  ServerContext,
  ListDefiTokensRequest,
  ListDefiTokensResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'market:defi-tokens:v1';

type TokenSeedEntry = { name: string; symbol: string; price: number; change24h: number; change7d: number };

export async function listDefiTokens(
  _ctx: ServerContext,
  _req: ListDefiTokensRequest,
): Promise<ListDefiTokensResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for list defi tokens has not written this key', (raw) => {
    const seedData = raw as { tokens: TokenSeedEntry[] } | null;
    if (!seedData?.tokens?.length) return { tokens: [] };
    const tokens: CryptoQuote[] = seedData.tokens.map(t => ({
      name: t.name,
      symbol: t.symbol,
      price: t.price,
      change: t.change24h,
      change7d: t.change7d,
      sparkline: [],
    }));
    return { tokens };
  });
}
