import type {
  GetConsumerPriceOverviewRequest,
  GetConsumerPriceOverviewResponse,
} from '../../../../src/generated/server/worldmonitor/consumer_prices/v1/service_server';

import { attach } from '../../../_shared/data-status';

const DEFAULT_MARKET = 'ae';

const EMPTY: GetConsumerPriceOverviewResponse = {
  marketCode: DEFAULT_MARKET,
  asOf: '0',
  currencyCode: 'AED',
  essentialsIndex: 0,
  valueBasketIndex: 0,
  wowPct: 0,
  momPct: 0,
  retailerSpreadPct: 0,
  coveragePct: 0,
  freshnessLagMin: 0,
  topCategories: [],
  upstreamUnavailable: true,
};

export async function getConsumerPriceOverview(
  _ctx: unknown,
  req: GetConsumerPriceOverviewRequest,
): Promise<GetConsumerPriceOverviewResponse> {
  const market = req.marketCode || DEFAULT_MARKET;
  const key = `consumer-prices:overview:${market}`;

  return attach(key, 'the seeder for get consumer price overview has not written this key', (raw) => {
    const result = raw as GetConsumerPriceOverviewResponse | null;
    return result ?? { ...EMPTY, marketCode: market };
  });
}
