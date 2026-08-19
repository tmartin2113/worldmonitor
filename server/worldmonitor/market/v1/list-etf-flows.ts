/**
 * RPC: ListEtfFlows -- reads seeded BTC spot ETF data from Railway seed cache.
 * All external Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListEtfFlowsRequest,
  ListEtfFlowsResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'market:etf-flows:v1';

const EMPTY_RESPONSE: ListEtfFlowsResponse = {
  timestamp: new Date().toISOString(),
  summary: {
    etfCount: 0,
    totalVolume: 0,
    totalEstFlow: 0,
    netDirection: 'UNAVAILABLE',
    inflowCount: 0,
    outflowCount: 0,
  },
  etfs: [],
  rateLimited: false,
};

export async function listEtfFlows(
  _ctx: ServerContext,
  _req: ListEtfFlowsRequest,
): Promise<ListEtfFlowsResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for list etf flows has not written this key', (raw) => {
    const seedData = raw as ListEtfFlowsResponse | null;
    return seedData || EMPTY_RESPONSE;
  });
}
