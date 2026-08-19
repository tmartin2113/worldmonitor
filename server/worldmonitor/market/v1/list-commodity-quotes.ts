/**
 * RPC: ListCommodityQuotes -- reads seeded commodity data from Railway seed cache.
 * All external Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListCommodityQuotesRequest,
  ListCommodityQuotesResponse,
  CommodityQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { parseStringArray } from './_shared';
import { readSeeded, withCount } from '../../../_shared/data-status';

const BOOTSTRAP_KEY = 'market:commodities-bootstrap:v1';

export async function listCommodityQuotes(
  _ctx: ServerContext,
  req: ListCommodityQuotesRequest,
): Promise<ListCommodityQuotesResponse> {
  const symbols = parseStringArray(req.symbols);
  if (!symbols.length) {
    return { quotes: [], dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no symbols requested; nothing was looked up' } };
  }

  const read = await readSeeded<ListCommodityQuotesResponse>(
    BOOTSTRAP_KEY,
    'the ais-relay commodities bootstrap has not written a snapshot.',
  );
  const symbolSet = new Set(symbols);
  const quotes = (read.data?.quotes ?? []).filter((q: CommodityQuote) => symbolSet.has(q.symbol));
  return { quotes, dataStatus: withCount(read.status, quotes.length) };
}
