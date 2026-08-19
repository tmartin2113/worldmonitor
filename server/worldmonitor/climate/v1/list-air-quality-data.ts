import type {
  ClimateServiceHandler,
  ListAirQualityDataRequest,
  ListAirQualityDataResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import {
  normalizeAirQualityFetchedAt,
  normalizeAirQualityStations,
} from '../../../_shared/air-quality-stations';
import { CLIMATE_AIR_QUALITY_KEY } from '../../../_shared/cache-keys';
import { attach } from '../../../_shared/data-status';

export const listAirQualityData: ClimateServiceHandler['listAirQualityData'] = async (
  _ctx: ServerContext,
  _req: ListAirQualityDataRequest,
): Promise<ListAirQualityDataResponse> => {
  return attach(CLIMATE_AIR_QUALITY_KEY, 'the air-quality seeder has not written this key', (cached) => {
    const payload = cached as Record<string, unknown> | null;
    const sourceStations = payload?.stations ?? payload?.alerts;
    return {
      stations: normalizeAirQualityStations(sourceStations),
      fetchedAt: normalizeAirQualityFetchedAt(payload),
    };
  }, (out) => out.stations.length);
};
