import type {
  ServerContext,
  GetSummarizeArticleCacheRequest,
  SummarizeArticleResponse,
} from '../../../../src/generated/server/worldmonitor/news/v1/service_server';

import filterParamContracts from '../../../../shared/openapi-filter-param-contracts.json';
import { getCachedJson } from '../../../_shared/redis';
import { answeredDirectly, upstreamError } from '../../../_shared/data-status';
import { markNoCacheResponse } from '../../../_shared/response-headers';

const CACHE_KEY_PATTERN = new RegExp(filterParamContracts.newsSummarizeArticleCacheKeyPattern);
const NEG_SENTINEL = '__WM_NEG__';

const EMPTY_MISS: SummarizeArticleResponse = {
  summary: '',
  model: '',
  provider: '',
  tokens: 0,
  fallback: true,
  error: '',
  errorType: '',
  status: 'SUMMARIZE_STATUS_UNSPECIFIED',
  statusDetail: '',
};

export async function getSummarizeArticleCache(
  ctx: ServerContext,
  req: GetSummarizeArticleCacheRequest,
): Promise<SummarizeArticleResponse> {
  const { cacheKey } = req;

  if (!cacheKey || !CACHE_KEY_PATTERN.test(cacheKey)) {
    markNoCacheResponse(ctx.request);
    return { ...EMPTY_MISS, status: 'SUMMARIZE_STATUS_ERROR', statusDetail: 'Invalid cache key', error: 'Invalid cache key', errorType: 'ValidationError' };
  }

  try {
    const cached = await getCachedJson(cacheKey);

    if (cached === NEG_SENTINEL || cached === null || cached === undefined) {
      markNoCacheResponse(ctx.request);
      return { ...EMPTY_MISS, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no cached summary for this key' } };
    }

    const data = cached as { summary?: string; model?: string; tokens?: number };
    if (!data.summary) {
      markNoCacheResponse(ctx.request);
      return { ...EMPTY_MISS, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no cached summary for this key' } };
    }

    return {
      summary: data.summary,
      model: data.model || '',
      provider: 'cache',
      tokens: 0,
      fallback: false,
      error: '',
      errorType: '',
      status: 'SUMMARIZE_STATUS_CACHED',
      statusDetail: '',
      dataStatus: answeredDirectly(),
    };
  } catch (err) {
    // A cache MISS and a Redis outage both returned EMPTY_MISS, so the caller
    // would re-summarize (paying for an LLM call) believing nothing was cached.
    markNoCacheResponse(ctx.request);
    return { ...EMPTY_MISS, dataStatus: upstreamError(err, 'summary cache read failed') };
  }
}
