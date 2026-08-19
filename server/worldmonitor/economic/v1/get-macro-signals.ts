/**
 * RPC: getMacroSignals -- reads seeded macro signal data from Railway seed cache.
 * All external Yahoo Finance/Alternative.me/Mempool calls happen in seed-economy.mjs on Railway.
 */

import type {
  ServerContext,
  GetMacroSignalsRequest,
  GetMacroSignalsResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:macro-signals:v1';

function buildFallbackResult(): GetMacroSignalsResponse {
  return {
    timestamp: new Date().toISOString(),
    verdict: 'UNKNOWN',
    bullishCount: 0,
    totalCount: 0,
    signals: {
      liquidity: { status: 'UNKNOWN', sparkline: [] },
      flowStructure: { status: 'UNKNOWN' },
      macroRegime: { status: 'UNKNOWN' },
      technicalTrend: { status: 'UNKNOWN', sparkline: [] },
      hashRate: { status: 'UNKNOWN' },
      priceMomentum: { status: 'UNKNOWN' },
      fearGreed: { status: 'UNKNOWN', history: [] },
    },
    meta: { qqqSparkline: [] },
    unavailable: true,
  };
}

export async function getMacroSignals(
  _ctx: ServerContext,
  _req: GetMacroSignalsRequest,
): Promise<GetMacroSignalsResponse> {
  return attach(SEED_CACHE_KEY, 'the macro-signals seeder has not written this key', (raw) => {
    const result = raw as GetMacroSignalsResponse | null;
    if (result && !result.unavailable && result.totalCount > 0) return result;
    return buildFallbackResult();
  }, (out) => out.totalCount ?? 0);
}
