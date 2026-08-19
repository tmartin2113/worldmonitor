import type {
  InfrastructureServiceHandler,
  ServerContext,
  GetBootstrapDataRequest,
  GetBootstrapDataResponse,
} from '../../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';
import { BOOTSTRAP_CACHE_KEYS, BOOTSTRAP_TIERS } from '../../../_shared/cache-keys';
import { getCachedJsonBatch } from '../../../_shared/redis';
import { upstreamError } from '../../../_shared/data-status';

// Iran-events domain sunset (war ended 2026-07). Default OFF: this RPC bootstrap
// surface must also stop shipping iranEvents, mirroring api/bootstrap.js. It
// reads the SHARED BOOTSTRAP_CACHE_KEYS, so the gate lives here. Set
// IRAN_EVENTS_ENABLED=true to restore. See api/health.js.
const IRAN_EVENTS_ENABLED = (process.env.IRAN_EVENTS_ENABLED ?? 'false').toLowerCase() === 'true';

function buildRegistry(req: GetBootstrapDataRequest): Record<string, string> {
  let registry: Record<string, string>;
  if (req.tier === 'slow' || req.tier === 'fast') {
    registry = Object.fromEntries(
      Object.entries(BOOTSTRAP_CACHE_KEYS).filter(([key]) => BOOTSTRAP_TIERS[key] === req.tier),
    );
  } else if (req.keys.length > 0) {
    registry = Object.fromEntries(
      Object.entries(BOOTSTRAP_CACHE_KEYS).filter(([key]) => req.keys.includes(key)),
    );
  } else {
    // Copy so the sunset delete below never mutates the shared registry.
    registry = { ...BOOTSTRAP_CACHE_KEYS };
  }

  if (!IRAN_EVENTS_ENABLED) delete registry.iranEvents;
  return registry;
}

/**
 * GetBootstrapData performs bulk Redis key retrieval for initial app state.
 */
export const getBootstrapData: InfrastructureServiceHandler['getBootstrapData'] = async (
  _ctx: ServerContext,
  req: GetBootstrapDataRequest,
): Promise<GetBootstrapDataResponse> => {
  const registry = buildRegistry(req);

  const names = Object.keys(registry);
  const cacheKeys = Object.values(registry);

  try {
    const cached = await getCachedJsonBatch(cacheKeys);
    const data: Record<string, string> = {};
    const missing: string[] = [];

    for (let i = 0; i < names.length; i += 1) {
      const keyName = names[i]!;
      const cacheKey = cacheKeys[i]!;
      const value = cached.get(cacheKey);
      if (value === undefined) {
        missing.push(keyName);
        continue;
      }
      data[keyName] = JSON.stringify(value);
    }

    // This handler already knew exactly which inputs were absent; it just had no
    // way to say so in a word. PARTIAL is that word.
    const shown = missing.length <= 5 ? missing.join(', ') : `${missing.slice(0, 5).join(', ')} and ${missing.length - 5} more`;
    return {
      data,
      missing,
      dataStatus: missing.length === 0
        ? { fetchedAt: '0', availability: 'DATA_AVAILABILITY_OK', detail: '' }
        : missing.length === names.length
          ? { fetchedAt: '0', availability: 'DATA_AVAILABILITY_NEVER_SEEDED',
              detail: `none of the ${names.length} bootstrap inputs has been written` }
          : { fetchedAt: '0', availability: 'DATA_AVAILABILITY_PARTIAL',
              detail: `${missing.length} of ${names.length} bootstrap inputs missing (${shown}); the rest were read normally` },
    };
  } catch (err) {
    // The old catch returned `missing: names` — every input marked absent, which
    // is exactly what a genuinely unseeded box looks like. A batch read that
    // THREW is a fault, and now says so.
    return {
      data: {},
      missing: names,
      dataStatus: upstreamError(err, 'bootstrap batch read failed'),
    };
  }
};
