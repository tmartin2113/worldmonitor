/**
 * ListUnrestEvents RPC -- reads seeded unrest data from Railway seed cache.
 * All external ACLED/GDELT API calls happen in seed-unrest.mjs on Railway.
 */

import type {
  ServerContext,
  ListUnrestEventsRequest,
  ListUnrestEventsResponse,
  UnrestEvent,
} from '../../../../src/generated/server/worldmonitor/unrest/v1/service_server';

import { sortBySeverityAndRecency } from './_shared';
import { readSeeded, withCount } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'unrest:events:v1';

function filterSeedEvents(
  events: UnrestEvent[],
  req: ListUnrestEventsRequest,
): UnrestEvent[] {
  let filtered = events;
  if (req.country) {
    const country = req.country.toLowerCase();
    filtered = filtered.filter(
      (e) => e.country.toLowerCase() === country || e.country.toLowerCase().includes(country),
    );
  }
  if (req.start > 0) {
    filtered = filtered.filter((e) => e.occurredAt >= req.start);
  }
  if (req.end > 0) {
    filtered = filtered.filter((e) => e.occurredAt <= req.end);
  }
  return filtered;
}

export async function listUnrestEvents(
  _ctx: ServerContext,
  req: ListUnrestEventsRequest,
): Promise<ListUnrestEventsResponse> {
  const read = await readSeeded<ListUnrestEventsResponse>(
    SEED_CACHE_KEY,
    'seed-unrest.mjs has not run (ACLED requires ACLED_API_KEY / ACLED_EMAIL). An empty list is not a claim that nothing is happening.',
  );
  const sorted = sortBySeverityAndRecency(filterSeedEvents(read.data?.events || [], req));
  return {
    events: sorted,
    clusters: [],
    pagination: undefined,
    dataStatus: withCount(read.status, sorted.length),
  };
}
