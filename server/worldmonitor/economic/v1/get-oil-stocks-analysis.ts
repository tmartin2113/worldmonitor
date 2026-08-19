/**
 * RPC: getOilStocksAnalysis -- reads seeded IEA oil stocks analysis from Railway seed cache.
 * Key written by afterPublish hook in seed-iea-oil-stocks.mjs.
 */

import type {
  ServerContext,
  GetOilStocksAnalysisRequest,
  GetOilStocksAnalysisResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'energy:oil-stocks-analysis:v1';

function buildFallbackResult(): GetOilStocksAnalysisResponse {
  return {
    updatedAt: '',
    dataMonth: '',
    ieaMembers: [],
    belowObligation: [],
    unavailable: true,
  };
}

export async function getOilStocksAnalysis(
  _ctx: ServerContext,
  _req: GetOilStocksAnalysisRequest,
): Promise<GetOilStocksAnalysisResponse> {
  return attach(SEED_CACHE_KEY, 'the IEA oil-stocks seeder has not written this key', (raw) => {
    const result = raw as GetOilStocksAnalysisResponse | null;
    if (result && Array.isArray(result.ieaMembers) && result.ieaMembers.length > 0) {
      return { ...result, unavailable: false };
    }
    return buildFallbackResult();
  }, (out) => out.ieaMembers?.length ?? 0);
}
