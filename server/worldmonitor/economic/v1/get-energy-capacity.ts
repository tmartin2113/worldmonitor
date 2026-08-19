/**
 * RPC: getEnergyCapacity -- reads seeded energy capacity data from Railway seed cache.
 * All external EIA API calls happen in seed-economy.mjs on Railway.
 */

import type {
  ServerContext,
  GetEnergyCapacityRequest,
  GetEnergyCapacityResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { readSeeded, withCount } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'economic:capacity:v1:COL,SUN,WND:20';

export async function getEnergyCapacity(
  _ctx: ServerContext,
  req: GetEnergyCapacityRequest,
): Promise<GetEnergyCapacityResponse> {
  const read = await readSeeded<GetEnergyCapacityResponse>(
    SEED_CACHE_KEY,
    'seed-economy.mjs has not written energy capacity (the EIA series requires EIA_API_KEY).',
  );
  let series = read.data?.series ?? [];
  if (req.energySources.length > 0) {
    series = series.filter(s => req.energySources.includes(s.energySource));
  }
  return { series, dataStatus: withCount(read.status, series.length) };
}
