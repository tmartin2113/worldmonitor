/**
 * RPC: getBisCredit -- reads BIS credit-to-GDP data from Railway seed cache.
 * All external BIS SDMX API calls happen in seed-bis-data.mjs on Railway.
 */

import type {
  ServerContext,
  GetBisCreditRequest,
  GetBisCreditResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:bis:credit:v1';

export async function getBisCredit(
  _ctx: ServerContext,
  _req: GetBisCreditRequest,
): Promise<GetBisCreditResponse> {
  return attach(SEED_CACHE_KEY, 'the BIS credit seeder has not written this key', (raw) => {
    const result = raw as GetBisCreditResponse | null;
    return result || { entries: [] };
  }, (out) => out.entries.length);
}
