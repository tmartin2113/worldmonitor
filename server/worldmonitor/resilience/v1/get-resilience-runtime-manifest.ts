import type {
  GetResilienceRuntimeManifestResponse,
  ResilienceRuntimeIntervalState,
  ResilienceServiceHandler,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/resilience/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { answeredDirectly } from '../../../_shared/data-status';
import { markNoCacheResponse } from '../../../_shared/response-headers';
import {
  RESILIENCE_RANKING_META_KEY,
  RESILIENCE_STATIC_META_KEY,
  RESILIENCE_INTERVAL_KEY_PREFIX,
  RESILIENCE_INTERVAL_METHODOLOGY,
  RESILIENCE_INTERVALS_META_KEY,
  getCurrentCacheFormula,
  isCurrentResilienceIntervalPayload,
  isEnergyV2Enabled,
  type ResilienceIntervalPayload,
} from './_shared';

const MANIFEST_VERSION = 4;
const INTERVAL_SAMPLE_COUNTRY = 'US';

const PUBLIC_CACHE_STATE = {
  scorePrefix: '',
  rankingKey: '',
  historyPrefix: '',
  intervalPrefix: '',
  intervalMethodology: '',
};

function getConstructVersions(): { energy: 'legacy' | 'v2' } {
  return {
    energy: isEnergyV2Enabled() ? 'v2' : 'legacy',
  };
}

interface SeedMeta {
  fetchedAt?: unknown;
}

interface RankingMeta {
  fetchedAt?: unknown;
  count?: unknown;
  scored?: unknown;
  total?: unknown;
}

function toIsoDate(value: unknown): string {
  const iso = toIsoTimestamp(value);
  return iso ? iso.slice(0, 10) : '';
}

function toIsoTimestamp(value: unknown): string {
  const date = typeof value === 'number' || typeof value === 'string'
    ? new Date(value)
    : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  return date.toISOString();
}

function safeNonNegativeInteger(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.trunc(num);
}

function latestIsoTimestamp(values: unknown[]): string {
  const timestamps = values
    .map(toIsoTimestamp)
    .filter((value): value is string => value.length > 0)
    .map((value) => Date.parse(value));
  if (timestamps.length === 0) return '';
  return new Date(Math.max(...timestamps)).toISOString();
}

async function getIntervalState(): Promise<ResilienceRuntimeIntervalState> {
  const [intervalMeta, sampleInterval] = await Promise.all([
    getCachedJson(RESILIENCE_INTERVALS_META_KEY, true) as Promise<SeedMeta | null>,
    getCachedJson(`${RESILIENCE_INTERVAL_KEY_PREFIX}${INTERVAL_SAMPLE_COUNTRY}`, true) as Promise<ResilienceIntervalPayload | null>,
  ]);

  return {
    available: isCurrentResilienceIntervalPayload(sampleInterval),
    methodology: RESILIENCE_INTERVAL_METHODOLOGY,
    sampleCountry: INTERVAL_SAMPLE_COUNTRY,
    lastObservedAt: latestIsoTimestamp([
      intervalMeta?.fetchedAt,
      sampleInterval?.computedAt,
    ]),
  };
}

export const getResilienceRuntimeManifest: ResilienceServiceHandler['getResilienceRuntimeManifest'] = async (
  ctx: ServerContext,
): Promise<GetResilienceRuntimeManifestResponse> => {
  markNoCacheResponse(ctx.request);

  const [staticMeta, rankingMeta, intervals] = await Promise.all([
    getCachedJson(RESILIENCE_STATIC_META_KEY, true) as Promise<SeedMeta | null>,
    getCachedJson(RESILIENCE_RANKING_META_KEY, true) as Promise<RankingMeta | null>,
    getIntervalState(),
  ]);

  return {
    manifestVersion: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    deployedCommitSha: '',
    vercelEnv: '',
    formulaTag: getCurrentCacheFormula(),
    dataVersion: toIsoDate(staticMeta?.fetchedAt),
    flags: [],
    cache: PUBLIC_CACHE_STATE,
    rankingCache: {
      fetchedAt: toIsoTimestamp(rankingMeta?.fetchedAt),
      count: safeNonNegativeInteger(rankingMeta?.count),
      scored: safeNonNegativeInteger(rankingMeta?.scored),
      total: safeNonNegativeInteger(rankingMeta?.total),
    },
    constructVersions: getConstructVersions(),
    intervals,
    // A manifest describes the runtime, so it answers from its own state; the
    // envelope reports whether the two cache-meta reads it embeds succeeded.
    dataStatus: (staticMeta && rankingMeta)
      ? answeredDirectly()
      : (!staticMeta && !rankingMeta)
        ? { fetchedAt: '0', availability: 'DATA_AVAILABILITY_PARTIAL', detail: 'neither the static nor the ranking cache metadata could be read; their fields are zeroed rather than unknown' }
        : { fetchedAt: '0', availability: 'DATA_AVAILABILITY_PARTIAL', detail: `the ${staticMeta ? 'ranking' : 'static'} cache metadata could be read; its fields are zeroed rather than unknown` },
  };
};
