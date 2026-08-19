/**
 * RPC: getCrudeInventories -- reads seeded EIA WCRSTUS1 crude oil inventory data.
 * All external EIA API calls happen in seed-economy.mjs on Railway.
 */

import type {
  ServerContext,
  GetCrudeInventoriesRequest,
  GetCrudeInventoriesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { readSeeded, withCount } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:crude-inventories:v1';

export async function getCrudeInventories(
  _ctx: ServerContext,
  _req: GetCrudeInventoriesRequest,
): Promise<GetCrudeInventoriesResponse> {
  const read = await readSeeded<GetCrudeInventoriesResponse>(
    SEED_CACHE_KEY,
    'seed-economy.mjs has not written crude inventories (the EIA series requires EIA_API_KEY).',
  );
  const weeks = read.data?.weeks ?? [];
  return {
    weeks,
    latestPeriod: read.data?.latestPeriod ?? '',
    dataStatus: withCount(read.status, weeks.length),
  };
}
