import type {
  ServerContext,
  ListIranEventsRequest,
  ListIranEventsResponse,
} from '../../../../src/generated/server/worldmonitor/conflict/v1/service_server';

import { readSeeded, withCount } from '../../../_shared/data-status';

const REDIS_KEY = 'conflict:iran-events:v1';

// Iran-events domain sunset (war ended 2026-07). Default OFF: serve empty
// immediately rather than the stale cached snapshot that lingers for the key's
// 14-day TTL. Set IRAN_EVENTS_ENABLED=true to restore. See api/health.js.
const IRAN_EVENTS_ENABLED = (process.env.IRAN_EVENTS_ENABLED ?? 'false').toLowerCase() === 'true';

export async function listIranEvents(
  _ctx: ServerContext,
  _req: ListIranEventsRequest,
): Promise<ListIranEventsResponse> {
  // Empty because the domain is switched OFF, which is a deliberate answer and
  // not a missing feed. Saying so is the entire point of the envelope.
  if (!IRAN_EVENTS_ENABLED) {
    return {
      events: [],
      scrapedAt: '0',
      dataStatus: {
        fetchedAt: '0',
        availability: 'DATA_AVAILABILITY_EMPTY',
        detail: 'Iran-events was sunset after the war ended 2026-07 and is serving empty deliberately. Set IRAN_EVENTS_ENABLED=true to restore.',
      },
    };
  }

  const read = await readSeeded<ListIranEventsResponse>(
    REDIS_KEY,
    'the Iran-events seeder has not run since the domain was re-enabled.',
  );
  const events = read.data?.events ?? [];
  return {
    events,
    scrapedAt: read.data?.scrapedAt ?? '0',
    dataStatus: withCount(read.status, events.length),
  };
}
