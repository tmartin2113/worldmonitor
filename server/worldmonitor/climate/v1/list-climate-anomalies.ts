/**
 * ListClimateAnomalies RPC -- reads seeded climate data from Railway seed cache.
 * All external Open-Meteo API calls happen in the climate seed scripts on Railway.
 */

import type {
  ClimateServiceHandler,
  ServerContext,
  ListClimateAnomaliesRequest,
  ListClimateAnomaliesResponse,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import { readSeeded, withCount } from '../../../_shared/data-status';
import { CLIMATE_ANOMALIES_KEY } from '../../../_shared/cache-keys';

export const listClimateAnomalies: ClimateServiceHandler['listClimateAnomalies'] = async (
  _ctx: ServerContext,
  _req: ListClimateAnomaliesRequest,
): Promise<ListClimateAnomaliesResponse> => {
  const read = await readSeeded<ListClimateAnomaliesResponse>(
    CLIMATE_ANOMALIES_KEY,
    'the climate seeder has not run. An empty anomaly list is not a claim that the climate is normal.',
  );
  const anomalies = read.data?.anomalies || [];
  return { anomalies, pagination: undefined, dataStatus: withCount(read.status, anomalies.length) };
};
