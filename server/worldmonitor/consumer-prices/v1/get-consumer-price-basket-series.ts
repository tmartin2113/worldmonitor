import type {
  GetConsumerPriceBasketSeriesRequest,
  GetConsumerPriceBasketSeriesResponse,
} from '../../../../src/generated/server/worldmonitor/consumer_prices/v1/service_server';

import { attach } from '../../../_shared/data-status';

const DEFAULT_MARKET = 'ae';
const DEFAULT_BASKET = 'essentials-ae';
const DEFAULT_RANGE = '30d';

const VALID_RANGES = new Set(['7d', '30d', '90d', '180d']);

export async function getConsumerPriceBasketSeries(
  _ctx: unknown,
  req: GetConsumerPriceBasketSeriesRequest,
): Promise<GetConsumerPriceBasketSeriesResponse> {
  const market = req.marketCode || DEFAULT_MARKET;
  const basket = req.basketSlug || DEFAULT_BASKET;
  const range = VALID_RANGES.has(req.range ?? '') ? req.range! : DEFAULT_RANGE;

  const key = `consumer-prices:basket-series:${market}:${basket}:${range}`;

  const EMPTY: GetConsumerPriceBasketSeriesResponse = {
    marketCode: market,
    basketSlug: basket,
    asOf: '0',
    currencyCode: 'AED',
    range,
    essentialsSeries: [],
    valueSeries: [],
    upstreamUnavailable: true,
  };

  return attach(key, 'the seeder for get consumer price basket series has not written this key', (raw) => {
    const result = raw as GetConsumerPriceBasketSeriesResponse | null;
    return result ?? EMPTY;
  });
}
