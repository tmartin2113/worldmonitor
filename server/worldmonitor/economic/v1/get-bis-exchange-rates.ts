/**
 * RPC: getBisExchangeRates -- reads BIS exchange rate data from Railway seed cache.
 * All external BIS SDMX API calls happen in seed-bis-data.mjs on Railway.
 */

import type {
  ServerContext,
  GetBisExchangeRatesRequest,
  GetBisExchangeRatesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:bis:eer:v1';

export async function getBisExchangeRates(
  _ctx: ServerContext,
  _req: GetBisExchangeRatesRequest,
): Promise<GetBisExchangeRatesResponse> {
  return attach(SEED_CACHE_KEY, 'the BIS exchange-rate seeder has not written this key', (raw) => {
    const result = raw as GetBisExchangeRatesResponse | null;
    return result || { rates: [] };
  }, (out) => out.rates.length);
}
