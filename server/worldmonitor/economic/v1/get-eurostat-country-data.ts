/**
 * RPC: getEurostatCountryData -- reads seeded Eurostat per-country economic data.
 * All external Eurostat API calls happen in seed-eurostat-country-data.mjs on Railway.
 */

import type {
  ServerContext,
  GetEurostatCountryDataRequest,
  GetEurostatCountryDataResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:eurostat-country-data:v1';

function buildFallbackResult(): GetEurostatCountryDataResponse {
  return {
    countries: {},
    seededAt: '0',
    unavailable: true,
  };
}

export async function getEurostatCountryData(
  _ctx: ServerContext,
  _req: GetEurostatCountryDataRequest,
): Promise<GetEurostatCountryDataResponse> {
  return attach(SEED_CACHE_KEY, 'the Eurostat seeder has not written this key', (cached) => {
    const raw = cached as Record<string, unknown> | null;
    if (!raw || !raw.countries || Object.keys(raw.countries as object).length === 0) {
      return buildFallbackResult();
    }
    return {
      countries: raw.countries as GetEurostatCountryDataResponse['countries'],
      seededAt: String(raw.seededAt ?? '0'),
      unavailable: false,
    };
  }, (out) => Object.keys(out.countries ?? {}).length);
}
