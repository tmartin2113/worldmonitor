/**
 * RPC: listAcledEvents -- Port from api/acled-conflict.js
 *
 * Proxies the ACLED API for battles, explosions, and violence against
 * civilians events within a configurable time range and optional country
 * filter.  Returns empty array on upstream failure (graceful degradation).
 */

import type {
  ServerContext,
  ListAcledEventsRequest,
  ListAcledEventsResponse,
  AcledConflictEvent,
} from '../../../../src/generated/server/worldmonitor/conflict/v1/service_server';

import { cachedFetchJson } from '../../../_shared/redis';
import { fetchAcledCached } from '../../../_shared/acled';
import { answeredDirectly, upstreamError } from '../../../_shared/data-status';

const REDIS_CACHE_KEY = 'conflict:acled:v1';
const REDIS_CACHE_TTL = 900; // 15 min — ACLED rate-limited
export const ACLED_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const fallbackAcledCache = new Map<string, { data: ListAcledEventsResponse; ts: number }>();

interface AcledEventWindow {
  startMs: number;
  endMs: number;
}

export function resolveAcledEventWindow(
  req: Pick<ListAcledEventsRequest, 'start' | 'end'>,
  now = Date.now(),
): AcledEventWindow {
  return {
    startMs: req.start > 0 ? req.start : now - ACLED_DEFAULT_WINDOW_MS,
    endMs: req.end > 0 ? req.end : now,
  };
}

async function fetchAcledConflicts(
  req: ListAcledEventsRequest,
  window: AcledEventWindow,
): Promise<AcledConflictEvent[]> {
  try {
    const startDate = new Date(window.startMs).toISOString().split('T')[0]!;
    const endDate = new Date(window.endMs).toISOString().split('T')[0]!;

    const rawEvents = await fetchAcledCached({
      eventTypes: 'Battles|Explosions/Remote violence|Violence against civilians',
      startDate,
      endDate,
      country: req.country || undefined,
    });

    return rawEvents
      .filter((e) => {
        const lat = parseFloat(e.latitude || '');
        const lon = parseFloat(e.longitude || '');
        return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
      })
      .map((e): AcledConflictEvent => ({
        id: `acled-${e.event_id_cnty}`,
        eventType: e.event_type || '',
        country: e.country || '',
        location: {
          latitude: parseFloat(e.latitude || '0'),
          longitude: parseFloat(e.longitude || '0'),
        },
        occurredAt: new Date(e.event_date || '').getTime(),
        fatalities: parseInt(e.fatalities || '', 10) || 0,
        actors: [e.actor1, e.actor2].filter(Boolean) as string[],
        source: e.source || '',
        admin1: e.admin1 || '',
      }));
  } catch (err) {
    // Rethrow: an ACLED auth/rate-limit failure is not "no conflict occurred".
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function listAcledEvents(
  _ctx: ServerContext,
  req: ListAcledEventsRequest,
): Promise<ListAcledEventsResponse> {
  const window = resolveAcledEventWindow(req);
  const cacheKey = `${REDIS_CACHE_KEY}:${req.country || 'all'}:${window.startMs}:${window.endMs}`;
  try {
    const result = await cachedFetchJson<ListAcledEventsResponse>(
      cacheKey,
      REDIS_CACHE_TTL,
      async () => {
        const events = await fetchAcledConflicts(req, window);
        return events.length > 0 ? { events, pagination: undefined } : null;
      },
    );
    if (result) {
      if (fallbackAcledCache.size > 50) fallbackAcledCache.clear();
      fallbackAcledCache.set(cacheKey, { data: result, ts: Date.now() });
      return { events: result.events, pagination: undefined, dataStatus: answeredDirectly() };
    }
    // Serving the in-process fallback means this is NOT a fresh answer.
    const stale = fallbackAcledCache.get(cacheKey);
    if (stale) {
      return {
        events: stale.data.events,
        pagination: undefined,
        dataStatus: {
          fetchedAt: String(stale.ts),
          availability: 'DATA_AVAILABILITY_STALE',
          detail: 'served from the in-process fallback cache; the current fetch returned nothing',
        },
      };
    }
    return {
      events: [],
      pagination: undefined,
      dataStatus: {
        fetchedAt: '0',
        availability: 'DATA_AVAILABILITY_EMPTY',
        detail: 'ACLED returned no events for this window and country filter',
      },
    };
  } catch (err) {
    const stale = fallbackAcledCache.get(cacheKey);
    if (stale) {
      return {
        events: stale.data.events,
        pagination: undefined,
        dataStatus: {
          fetchedAt: String(stale.ts),
          availability: 'DATA_AVAILABILITY_STALE',
          detail: 'ACLED fetch failed; serving the last good in-process snapshot',
        },
      };
    }
    return { events: [], pagination: undefined, dataStatus: upstreamError(err, 'ACLED fetch failed') };
  }
}
