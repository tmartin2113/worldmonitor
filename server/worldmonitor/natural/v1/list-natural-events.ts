/**
 * ListNaturalEvents RPC -- reads seeded natural disaster data from Railway seed cache.
 * All external EONET/GDACS/NHC API calls happen in seed-natural-events.mjs on Railway.
 */

import type {
  NaturalServiceHandler,
  ServerContext,
  ListNaturalEventsRequest,
  ListNaturalEventsResponse,
} from '../../../../src/generated/server/worldmonitor/natural/v1/service_server';

import { cacheTally } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'natural:events:v1';
const SEED_META_KEY = 'seed-meta:natural:events';

interface SeedMeta {
  fetchedAt?: number;
}

export const listNaturalEvents: NaturalServiceHandler['listNaturalEvents'] = async (
  _ctx: ServerContext,
  _req: ListNaturalEventsRequest,
): Promise<ListNaturalEventsResponse> => {
  // The meta key is marked optional: it only supplies a fetchedAt fallback, so
  // its absence must not make an otherwise-complete answer report PARTIAL.
  const tally = cacheTally('the natural-events seeder has not written this key');
  const [result, meta] = await Promise.all([
    tally.read<Partial<ListNaturalEventsResponse>>(SEED_CACHE_KEY),
    tally.read<SeedMeta>(SEED_META_KEY, { optional: true }),
  ]);
  if (!result) {
    return { events: [], fetchedAt: 0, dataAvailable: false, dataStatus: tally.status() };
  }

  return {
    events: result.events ?? [],
    fetchedAt: Number(result.fetchedAt || meta?.fetchedAt || 0),
    dataAvailable: true,
    dataStatus: tally.status(),
  };
};
