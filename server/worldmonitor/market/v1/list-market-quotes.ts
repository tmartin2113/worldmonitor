/**
 * RPC: ListMarketQuotes -- reads seeded stock/index data from Railway seed cache.
 * All external Finnhub/Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListMarketQuotesRequest,
  ListMarketQuotesResponse,
  MarketQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { parseStringArray } from './_shared';
import { attach } from '../../../_shared/data-status';

const BOOTSTRAP_KEY = 'market:stocks-bootstrap:v1';

export async function listMarketQuotes(
  _ctx: ServerContext,
  req: ListMarketQuotesRequest,
): Promise<ListMarketQuotesResponse> {
  const parsedSymbols = parseStringArray(req.symbols);

  return attach(BOOTSTRAP_KEY, 'the seeder for list market quotes has not written this key', (raw) => {
    const bootstrap = raw as ListMarketQuotesResponse | null;
    if (!bootstrap?.quotes?.length) {
      return { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
    }

    if (parsedSymbols.length > 0) {
      const symbolSet = new Set(parsedSymbols);
      const filtered = bootstrap.quotes.filter((q: MarketQuote) => symbolSet.has(q.symbol));
      return { quotes: filtered, finnhubSkipped: false, skipReason: '', rateLimited: false };
    }

    return bootstrap;
  });
}
