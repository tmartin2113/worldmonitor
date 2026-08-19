import type {
  HealthServiceHandler,
  ServerContext,
  ListDiseaseOutbreaksRequest,
  ListDiseaseOutbreaksResponse,
} from '../../../../src/generated/server/worldmonitor/health/v1/service_server';

import { attach } from '../../../_shared/data-status';

const REDIS_KEY = 'health:disease-outbreaks:v1';

// Transitional read tolerance: cached payloads written before the
// alertLevelMethodologyVersion field was added (or by an older seeder
// revision) will not carry the field. Defaulting to 'v1' matches the
// initial published version in scripts/_disease-outbreaks-helpers.mjs,
// so old caches keep validating against the new proto contract until
// the next seed publish stamps the field explicitly.
const FALLBACK_METHODOLOGY_VERSION = 'v1';

export const listDiseaseOutbreaks: HealthServiceHandler['listDiseaseOutbreaks'] = async (
  _ctx: ServerContext,
  _req: ListDiseaseOutbreaksRequest,
): Promise<ListDiseaseOutbreaksResponse> => {
  // Previously returned `{outbreaks:[], fetchedAt:0}` for a missing key, a Redis
  // fault and a genuinely quiet week alike — and PASSED the empty-success sweep,
  // because carrying a timestamp is not the same as saying what happened.
  return attach(REDIS_KEY, 'the disease-outbreak seeder has not written this key', (cached) => {
    const data = cached as Partial<ListDiseaseOutbreaksResponse> | null;
    return {
      outbreaks: data?.outbreaks ?? [],
      fetchedAt: data?.fetchedAt ?? 0,
      alertLevelMethodologyVersion: data?.alertLevelMethodologyVersion ?? FALLBACK_METHODOLOGY_VERSION,
    };
  }, (out) => out.outbreaks.length);
};
