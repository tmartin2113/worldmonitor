/**
 * RPC: getTradeFlows -- reads seeded WTO trade flow data from Railway seed cache.
 * All external WTO API calls happen in seed-supply-chain-trade.mjs on Railway.
 */
import type {
  ServerContext,
  GetTradeFlowsRequest,
  GetTradeFlowsResponse,
} from '../../../../src/generated/server/worldmonitor/trade/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_KEY_PREFIX = 'trade:flows:v1';

function isValidCode(c: string): boolean {
  return /^[a-zA-Z0-9]{1,10}$/.test(c);
}

export async function getTradeFlows(
  _ctx: ServerContext,
  req: GetTradeFlowsRequest,
): Promise<GetTradeFlowsResponse> {
  const reporter = isValidCode(req.reportingCountry) ? req.reportingCountry : '840';
  const partner = isValidCode(req.partnerCountry) ? req.partnerCountry : '000';
  const years = Math.max(1, Math.min(req.years > 0 ? req.years : 10, 30));
  const seedKey = `${SEED_KEY_PREFIX}:${reporter}:${partner}:${years}`;

  return attach(seedKey, 'the trade-flows seeder has not written this key', (__cachedValue) => {
    const result = __cachedValue as GetTradeFlowsResponse | null;
    if (!result?.flows?.length) {
      return { flows: [], fetchedAt: new Date().toISOString(), upstreamUnavailable: true };
    }
    return result;
  });
}
