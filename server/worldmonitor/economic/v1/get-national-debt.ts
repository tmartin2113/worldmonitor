/**
 * RPC: getNationalDebt -- reads seeded national debt data from Railway seed cache.
 * All external IMF/Treasury calls happen in seed-national-debt.mjs on Railway.
 */

import type {
  ServerContext,
  GetNationalDebtRequest,
  GetNationalDebtResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';
import { isCallerPremium } from '../../../_shared/premium-check';

const SEED_CACHE_KEY = 'economic:national-debt:v1';

function buildFallbackResult(): GetNationalDebtResponse {
  return {
    entries: [],
    seededAt: '',
    unavailable: true,
  };
}

export async function getNationalDebt(
  ctx: ServerContext,
  _req: GetNationalDebtRequest,
): Promise<GetNationalDebtResponse> {
  const isPro = await isCallerPremium(ctx.request);
  // Entitlement, not absence: the caller is not entitled to this data, which is a
  // different answer from "we hold none" and should not read as an empty dataset.
  if (!isPro) {
    return {
      ...buildFallbackResult(),
      dataStatus: {
        fetchedAt: '0',
        availability: 'DATA_AVAILABILITY_EMPTY',
        detail: 'national debt detail requires a premium caller; no lookup was performed',
      },
    };
  }

  return attach(SEED_CACHE_KEY, 'the national-debt seeder has not written this key', (raw) => {
    const result = raw as GetNationalDebtResponse | null;
    if (result && !result.unavailable && result.entries && result.entries.length > 0) return result;
    return buildFallbackResult();
  }, (out) => out.entries?.length ?? 0);
}
