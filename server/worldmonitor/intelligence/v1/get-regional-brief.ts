import type {
  IntelligenceServiceHandler,
  ServerContext,
  GetRegionalBriefRequest,
  GetRegionalBriefResponse,
  RegionalBrief,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { readSeeded, answeredDirectly } from '../../../_shared/data-status';

const KEY_PREFIX = 'intelligence:regional-briefs:v1:weekly:';

interface PersistedBrief {
  region_id?: string;
  generated_at?: number;
  period_start?: number;
  period_end?: number;
  situation_recap?: string;
  regime_trajectory?: string;
  key_developments?: string[];
  risk_outlook?: string;
  provider?: string;
  model?: string;
}

export function adaptBrief(raw: PersistedBrief): RegionalBrief {
  return {
    regionId: raw.region_id ?? '',
    generatedAt: typeof raw.generated_at === 'number' ? raw.generated_at : 0,
    periodStart: typeof raw.period_start === 'number' ? raw.period_start : 0,
    periodEnd: typeof raw.period_end === 'number' ? raw.period_end : 0,
    situationRecap: raw.situation_recap ?? '',
    regimeTrajectory: raw.regime_trajectory ?? '',
    keyDevelopments: Array.isArray(raw.key_developments) ? raw.key_developments.filter((d) => typeof d === 'string') : [],
    riskOutlook: raw.risk_outlook ?? '',
    provider: raw.provider ?? '',
    model: raw.model ?? '',
  };
}

export const getRegionalBrief: IntelligenceServiceHandler['getRegionalBrief'] = async (
  _ctx: ServerContext,
  req: GetRegionalBriefRequest,
): Promise<GetRegionalBriefResponse> => {
  const regionId = req.regionId;
  if (!regionId || typeof regionId !== 'string') {
    return { dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no region_id supplied; nothing was looked up' } };
  }

  const key = `${KEY_PREFIX}${regionId}`;

  // Use getRawJson (throws on Redis error) instead of getCachedJson (returns
  // null for both missing key AND Redis failure). This lets us distinguish:
  //   - null return = key genuinely missing (no brief yet) → clean empty 200
  //   - thrown error = Redis/network failure → upstreamUnavailable so gateway
  //     skips caching the failure response
  // PR #2989 review: getCachedJson collapsed both cases into null, which
  // falsely advertised an outage before the first weekly seed ran.
  // This handler already drew the miss-vs-error distinction by hand (see above);
  // readSeeded makes it the default and gives it a word the response can carry.
  const read = await readSeeded<PersistedBrief>(key, `no brief has been written for region ${regionId}`);
  if (read.status.availability === 'DATA_AVAILABILITY_UPSTREAM_ERROR') {
    return { upstreamUnavailable: true, dataStatus: read.status } as GetRegionalBriefResponse & { upstreamUnavailable: boolean };
  }

  const raw = read.data;
  if (!raw || typeof raw !== 'object') {
    // Key genuinely missing — no brief written yet for this region.
    // Return a clean empty response (no upstreamUnavailable) so the
    // gateway can cache this as a valid "no brief" result.
    return { dataStatus: read.status };
  }

  const brief = adaptBrief(raw);
  return { brief, dataStatus: answeredDirectly() };
};
