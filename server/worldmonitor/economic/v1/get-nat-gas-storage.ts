/**
 * RPC: getNatGasStorage -- reads seeded EIA NW2_EPG0_SWO_R48_BCF natural gas storage data.
 * All external EIA API calls happen in seed-economy.mjs on Railway.
 */

import type {
  ServerContext,
  GetNatGasStorageRequest,
  GetNatGasStorageResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { readSeeded, withCount } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:nat-gas-storage:v1';

export async function getNatGasStorage(
  _ctx: ServerContext,
  _req: GetNatGasStorageRequest,
): Promise<GetNatGasStorageResponse> {
  const read = await readSeeded<GetNatGasStorageResponse>(
    SEED_CACHE_KEY,
    'seed-economy.mjs has not written natural gas storage (the EIA series requires EIA_API_KEY).',
  );
  const weeks = read.data?.weeks ?? [];
  return {
    weeks,
    latestPeriod: read.data?.latestPeriod ?? '',
    dataStatus: withCount(read.status, weeks.length),
  };
}
