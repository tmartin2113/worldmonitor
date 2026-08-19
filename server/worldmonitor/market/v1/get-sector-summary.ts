/**
 * RPC: GetSectorSummary -- reads seeded sector data from Railway seed cache.
 * All external Finnhub/Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  GetSectorSummaryRequest,
  GetSectorSummaryResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'market:sectors:v2';

export async function getSectorSummary(
  _ctx: ServerContext,
  _req: GetSectorSummaryRequest,
): Promise<GetSectorSummaryResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for get sector summary has not written this key', (raw) => {
    const result = raw as GetSectorSummaryResponse | null;
    return result || { sectors: [] };
  });
}
