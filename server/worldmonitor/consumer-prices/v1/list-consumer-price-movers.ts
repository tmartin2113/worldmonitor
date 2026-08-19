import type {
  ListConsumerPriceMoversRequest,
  ListConsumerPriceMoversResponse,
} from '../../../../src/generated/server/worldmonitor/consumer_prices/v1/service_server';

import { attach } from '../../../_shared/data-status';

const DEFAULT_MARKET = 'ae';
const DEFAULT_RANGE = '30d';
const VALID_RANGES = new Set(['7d', '30d', '90d']);

export async function listConsumerPriceMovers(
  _ctx: unknown,
  req: ListConsumerPriceMoversRequest,
): Promise<ListConsumerPriceMoversResponse> {
  const market = req.marketCode || DEFAULT_MARKET;
  const range = VALID_RANGES.has(req.range ?? '') ? req.range! : DEFAULT_RANGE;
  const key = `consumer-prices:movers:${market}:${range}`;

  const EMPTY: ListConsumerPriceMoversResponse = {
    marketCode: market,
    asOf: '0',
    range,
    risers: [],
    fallers: [],
    upstreamUnavailable: true,
  };

  return attach(key, 'the seeder for list consumer price movers has not written this key', (raw) => {
    const cached = raw as ListConsumerPriceMoversResponse | null;
    if (!cached) return EMPTY;

    const limit = req.limit ?? 10;
    const filterCategory = req.categorySlug;

    const filter = (movers: typeof cached.risers) =>
      (filterCategory ? movers.filter((m) => m.category === filterCategory) : movers).slice(0, limit);

    return { ...cached, risers: filter(cached.risers), fallers: filter(cached.fallers) };
  });
}
