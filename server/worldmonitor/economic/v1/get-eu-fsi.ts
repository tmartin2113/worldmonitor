import type {
  ServerContext,
  GetEuFsiRequest,
  GetEuFsiResponse,
  EuFsiObservation,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';
import { attach } from '../../../_shared/data-status';
import { CISS_STALE_THRESHOLD_MS } from '../../../../src/shared/ciss-staleness';

const SEED_CACHE_KEY = 'economic:fsi-eu:v1';

// `stale` is set when the newest observation is older than the shared CISS
// content-age budget. The legacy SS_CI series stopped publishing; SS_CIN is the
// live successor, and this guard catches any future content freeze.
function isStale(latestDate: string): boolean {
  const ts = Date.parse(latestDate);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > CISS_STALE_THRESHOLD_MS;
}

function buildFallbackResult(): GetEuFsiResponse {
  return {
    latestValue: 0,
    latestDate: '',
    label: '',
    history: [],
    seededAt: '',
    unavailable: true,
    stale: false,
  };
}

export async function getEuFsi(
  _ctx: ServerContext,
  _req: GetEuFsiRequest,
): Promise<GetEuFsiResponse> {
  return attach(SEED_CACHE_KEY, 'the EU financial-stress seeder has not written this key', (cached) => {
    const raw = cached as Record<string, unknown> | null;
    if (!raw || raw.unavailable) return buildFallbackResult();

    const history = (Array.isArray(raw.history) ? raw.history : []) as EuFsiObservation[];
    const latestDate = String(raw.latestDate ?? '');

    return {
      latestValue: Number(raw.latestValue ?? 0),
      latestDate,
      label: String(raw.label ?? ''),
      history,
      seededAt: String(raw.seededAt ?? ''),
      unavailable: false,
      stale: isStale(latestDate),
    };
  }, (out) => out.history?.length ?? 0);
}
