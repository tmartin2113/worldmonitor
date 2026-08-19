/**
 * RPC: GetCountryStockIndex
 * Fetches national stock market index data from Yahoo Finance.
 */

import type {
  ServerContext,
  GetCountryStockIndexRequest,
  GetCountryStockIndexResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import filterParamContracts from '../../../../shared/openapi-filter-param-contracts.json';
import { UPSTREAM_TIMEOUT_MS, type YahooChartResponse } from './_shared';
import { CHROME_UA, yahooGate } from '../../../_shared/constants';
import { cachedFetchJson } from '../../../_shared/redis';
import { answeredDirectly, upstreamError } from '../../../_shared/data-status';

// ========================================================================
// Country-to-index mapping
// ========================================================================

const COUNTRY_INDEX = filterParamContracts.marketCountryStockIndexes as Record<string, { symbol: string; name: string }>;

// ========================================================================
// Cache
// ========================================================================

const REDIS_CACHE_KEY = 'market:stock-index:v1';
const REDIS_CACHE_TTL = 1800; // 30 min — weekly data, slow-moving

const stockIndexCache: Record<string, { data: GetCountryStockIndexResponse; ts: number }> = {};
const STOCK_INDEX_CACHE_TTL = 3_600_000; // 1 hour (in-memory fallback)

// ========================================================================
// Handler
// ========================================================================

export async function getCountryStockIndex(
  _ctx: ServerContext,
  req: GetCountryStockIndexRequest,
): Promise<GetCountryStockIndexResponse> {
  const code = (req.countryCode || '').toUpperCase();
  const notAvailable: GetCountryStockIndexResponse = {
    available: false, code, symbol: '', indexName: '', price: 0, weekChangePercent: 0, currency: '', fetchedAt: '',
  };

  // Three different reasons for `available: false` that all looked identical:
  // no code supplied, no index mapped for that country, and the fetch failing.
  if (!code) {
    return { ...notAvailable, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no country_code supplied; nothing was looked up' } };
  }

  const index = COUNTRY_INDEX[code];
  if (!index) {
    return { ...notAvailable, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: `no stock index is mapped for ${code}` } };
  }

  const cached = stockIndexCache[code];
  if (cached && Date.now() - cached.ts < STOCK_INDEX_CACHE_TTL) {
    return { ...cached.data, dataStatus: cached.data.dataStatus ?? answeredDirectly('served from the in-process cache') };
  }

  const redisKey = `${REDIS_CACHE_KEY}:${code}`;

  try {
  const result = await cachedFetchJson<GetCountryStockIndexResponse>(redisKey, REDIS_CACHE_TTL, async () => {
    const encodedSymbol = encodeURIComponent(index.symbol);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?range=1mo&interval=1d`;

    await yahooGate();
    const res = await fetch(yahooUrl, {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data: YahooChartResponse = await res.json();
    const chartResult = data?.chart?.result?.[0];
    if (!chartResult) return null;

    const allCloses = chartResult.indicators?.quote?.[0]?.close?.filter((v): v is number => v != null);
    if (!allCloses || allCloses.length < 2) return null;

    const closes = allCloses.slice(-6);
    const latest = closes[closes.length - 1]!;
    const oldest = closes[0]!;
    const weekChange = ((latest - oldest) / oldest) * 100;
    const meta = chartResult.meta || {};

    return {
      available: true,
      code,
      symbol: index.symbol,
      indexName: index.name,
      price: +latest.toFixed(2),
      weekChangePercent: +weekChange.toFixed(2),
      currency: (meta as { currency?: string }).currency || 'USD',
      fetchedAt: new Date().toISOString(),
    };
  });

  if (result?.available) {
    stockIndexCache[code] = { data: result, ts: Date.now() };
  }

  if (result) return { ...result, dataStatus: answeredDirectly() };
  const fallback = stockIndexCache[code]?.data;
  if (fallback) {
    return { ...fallback, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_STALE', detail: `live quote for ${code} unavailable; serving the last good in-process value` } };
  }
  return { ...notAvailable, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: `no quote returned for ${index.symbol}` } };
  } catch (err) {
    const fallback = stockIndexCache[code]?.data;
    if (fallback) {
      return { ...fallback, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_STALE', detail: `live quote fetch failed; serving the last good in-process value` } };
    }
    return { ...notAvailable, dataStatus: upstreamError(err, `stock index fetch for ${code} failed`) };
  }
}
