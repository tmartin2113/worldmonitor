/**
 * RPC: ListAiTokens -- reads seeded AI token data from Railway seed cache.
 */

import type {
  ServerContext,
  ListAiTokensRequest,
  ListAiTokensResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'market:ai-tokens:v1';

type TokenSeedEntry = { name: string; symbol: string; price: number; change24h: number; change7d: number };

export async function listAiTokens(
  _ctx: ServerContext,
  _req: ListAiTokensRequest,
): Promise<ListAiTokensResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for list ai tokens has not written this key', (raw) => {
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
