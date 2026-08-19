/**
 * RPC: getEuYieldCurve -- reads seeded ECB Euro Area AAA sovereign yield curve from Redis.
 * All external ECB API calls happen in scripts/seed-yield-curve-eu.mjs on Railway.
 */

import type {
  ServerContext,
  GetEuYieldCurveRequest,
  GetEuYieldCurveResponse,
  EuYieldCurveData,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const CACHE_KEY = 'economic:yield-curve-eu:v1';

export async function getEuYieldCurve(
  _ctx: ServerContext,
  _req: GetEuYieldCurveRequest,
): Promise<GetEuYieldCurveResponse> {
  return attach(CACHE_KEY, 'the EU yield-curve seeder has not written this key', (cached) => {
    if (!cached) return { unavailable: true };

    const data = cached as EuYieldCurveData & { rates?: Record<string, number> };
    if (!data.rates || Object.keys(data.rates).length === 0) return { unavailable: true };

    return { data, unavailable: false };
  }, (out) => (out.unavailable ? 0 : 1));
}
