/**
 * ListFireDetections RPC -- reads seeded wildfire data from Railway seed cache.
 * All external NASA FIRMS API calls happen in seed-wildfires.mjs on Railway.
 */

import type {
  WildfireServiceHandler,
  ServerContext,
  ListFireDetectionsRequest,
  ListFireDetectionsResponse,
} from '../../../../src/generated/server/worldmonitor/wildfire/v1/service_server';

import { cacheTally } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'wildfire:fires:v1';
const SEED_META_KEY = 'seed-meta:wildfire:fires';

interface SeedMeta {
  fetchedAt?: number;
}

export const listFireDetections: WildfireServiceHandler['listFireDetections'] = async (
  _ctx: ServerContext,
  _req: ListFireDetectionsRequest,
): Promise<ListFireDetectionsResponse> => {
  // The meta key is marked optional: it only supplies a fetchedAt fallback, so
  // its absence must not make an otherwise-complete answer report PARTIAL.
  const tally = cacheTally('the wildfire seeder has not written this key');
  const [result, meta] = await Promise.all([
    tally.read<Partial<ListFireDetectionsResponse>>(SEED_CACHE_KEY),
    tally.read<SeedMeta>(SEED_META_KEY, { optional: true }),
  ]);
  if (!result) {
    return { fireDetections: [], pagination: undefined, fetchedAt: 0, dataAvailable: false, dataStatus: tally.status() };
  }

  return {
    fireDetections: result.fireDetections ?? [],
    pagination: result.pagination,
    fetchedAt: Number(result.fetchedAt || meta?.fetchedAt || 0),
    dataAvailable: true,
    dataStatus: tally.status(),
  };
};
