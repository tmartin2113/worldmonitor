/**
 * RPC: getTradeBarriers -- reads seeded WTO tariff barrier data from Railway seed cache.
 * All external WTO API calls happen in seed-supply-chain-trade.mjs on Railway.
 */
import type {
  ServerContext,
  GetTradeBarriersRequest,
  GetTradeBarriersResponse,
} from '../../../../src/generated/server/worldmonitor/trade/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'trade:barriers:v1:tariff-gap:50';

export async function getTradeBarriers(
  _ctx: ServerContext,
  req: GetTradeBarriersRequest,
): Promise<GetTradeBarriersResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for get trade barriers has not written this key', (raw) => {
    const result = raw as GetTradeBarriersResponse | null;
    if (!result?.barriers?.length) {
      return { barriers: [], fetchedAt: new Date().toISOString(), upstreamUnavailable: true };
    }
    const limit = Math.max(1, Math.min(req.limit > 0 ? req.limit : 50, 100));
    return {
      barriers: result.barriers.slice(0, limit),
      fetchedAt: result.fetchedAt || new Date().toISOString(),
      upstreamUnavailable: false,
    };
  });
}
