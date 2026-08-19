import type {
  ServerContext,
  GetEcbFxRatesRequest,
  GetEcbFxRatesResponse,
  EcbFxRate,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:ecb-fx-rates:v1';

function buildFallback(): GetEcbFxRatesResponse {
  return { rates: [], updatedAt: '', seededAt: '0', unavailable: true };
}

export async function getEcbFxRates(
  _ctx: ServerContext,
  _req: GetEcbFxRatesRequest,
): Promise<GetEcbFxRatesResponse> {
  return attach(SEED_CACHE_KEY, 'the ECB FX seeder has not written this key', (raw) => {
    const cached = raw as {
      rates: Record<string, { rate: number; date: string; change1d: number }>;
      updatedAt: string;
      seededAt: number;
    } | null;

    if (!cached?.rates || Object.keys(cached.rates).length === 0) {
      return buildFallback();
    }

    const rates: EcbFxRate[] = Object.entries(cached.rates).map(([pair, r]) => ({
      pair,
      rate: r.rate,
      date: r.date,
      change1d: r.change1d,
    }));

    return {
      rates,
      updatedAt: cached.updatedAt ?? '',
      seededAt: String(cached.seededAt ?? 0),
      unavailable: false,
    };
  }, (out) => out.rates.length);
}
