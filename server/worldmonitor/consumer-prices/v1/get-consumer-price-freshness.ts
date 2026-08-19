import type {
  GetConsumerPriceFreshnessRequest,
  GetConsumerPriceFreshnessResponse,
} from '../../../../src/generated/server/worldmonitor/consumer_prices/v1/service_server';

import { attach } from '../../../_shared/data-status';

const DEFAULT_MARKET = 'ae';

export async function getConsumerPriceFreshness(
  _ctx: unknown,
  req: GetConsumerPriceFreshnessRequest,
): Promise<GetConsumerPriceFreshnessResponse> {
  const market = req.marketCode || DEFAULT_MARKET;
  const key = `consumer-prices:freshness:${market}`;

  const EMPTY: GetConsumerPriceFreshnessResponse = {
    marketCode: market,
    asOf: '0',
    retailers: [],
    overallFreshnessMin: 0,
    stalledCount: 0,
    upstreamUnavailable: true,
  };

  return attach(key, 'the seeder for get consumer price freshness has not written this key', (raw) => {
    const result = raw as GetConsumerPriceFreshnessResponse | null;
    return result ?? EMPTY;
  });
}
