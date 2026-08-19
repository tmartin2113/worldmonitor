/**
 * RPC: ListGulfQuotes -- reads seeded GCC market data from Railway seed cache.
 * All external Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListGulfQuotesRequest,
  ListGulfQuotesResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'market:gulf-quotes:v1';

export async function listGulfQuotes(
  _ctx: ServerContext,
  _req: ListGulfQuotesRequest,
): Promise<ListGulfQuotesResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for list gulf quotes has not written this key', (raw) => {
    const seedData = raw as ListGulfQuotesResponse | null;
    return seedData || { quotes: [], rateLimited: false };
  });
}
