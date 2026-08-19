/**
 * RPC: getBisPolicyRates -- reads BIS policy rate data from Railway seed cache.
 * All external BIS SDMX API calls happen in seed-bis-data.mjs on Railway.
 */

import type {
  ServerContext,
  GetBisPolicyRatesRequest,
  GetBisPolicyRatesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:bis:policy:v1';

export async function getBisPolicyRates(
  _ctx: ServerContext,
  _req: GetBisPolicyRatesRequest,
): Promise<GetBisPolicyRatesResponse> {
  return attach(SEED_CACHE_KEY, 'the BIS policy-rate seeder has not written this key', (raw) => {
    const result = raw as GetBisPolicyRatesResponse | null;
    return result || { rates: [] };
  }, (out) => out.rates.length);
}
