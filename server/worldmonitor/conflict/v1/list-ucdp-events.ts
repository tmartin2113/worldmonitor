import type {
  ServerContext,
  ListUcdpEventsRequest,
  ListUcdpEventsResponse,
  UcdpViolenceEvent,
} from '../../../../src/generated/server/worldmonitor/conflict/v1/service_server';
import { readSeeded, withCount } from '../../../_shared/data-status';

const CACHE_KEY = 'conflict:ucdp-events:v1';

// All UCDP fetching happens off-box (ais-relay seedUcdpEvents loop).
// This handler reads pre-seeded data from Redis only.

// THREE STATES, NOT ONE. This returned `{events: []}` for a missing cache key,
// for a read failure, AND for a genuinely quiet feed — so a consumer could not
// tell "there is no conflict data" from "we never fetched any". Measured
// 2026-08-19: 25 of 147 endpoints answered 200 with an unfalsifiable empty.
//
// Answered with an ADDITIVE `data_status` envelope rather than a 503, because a
// 503 is an API contract change every consumer sees, while an optional field is
// ignorable by anything that does not care. The status code stays 200: "I looked,
// here is what I found and why" is a successful request.
export async function listUcdpEvents(
  _ctx: ServerContext,
  req: ListUcdpEventsRequest,
): Promise<ListUcdpEventsResponse> {
  const read = await readSeeded<{ events?: UcdpViolenceEvent[] }>(
    CACHE_KEY,
    'the UCDP seeder is blocked (it requires UCDP_ACCESS_TOKEN). This is not a world without conflict events.',
  );

  let events = read.data?.events ?? [];
  if (req.country) events = events.filter((e) => e.country === req.country);

  return {
    events,
    pagination: undefined,
    dataStatus: withCount(read.status, events.length),
  };
}
