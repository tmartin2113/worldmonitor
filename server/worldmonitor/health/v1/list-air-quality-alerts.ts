import type {
  AirQualityAlert,
  HealthServiceHandler,
  ListAirQualityAlertsRequest,
  ListAirQualityAlertsResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/health/v1/service_server';

import {
  normalizeAirQualityFetchedAt,
  normalizeAirQualityStations,
} from '../../../_shared/air-quality-stations';
import { HEALTH_AIR_QUALITY_KEY } from '../../../_shared/cache-keys';
import { attach } from '../../../_shared/data-status';

export const listAirQualityAlerts: HealthServiceHandler['listAirQualityAlerts'] = async (
  _ctx: ServerContext,
  _req: ListAirQualityAlertsRequest,
): Promise<ListAirQualityAlertsResponse> => {
  return attach(HEALTH_AIR_QUALITY_KEY, 'the air-quality seeder has not written this key', (cached) => {
    const payload = cached as Record<string, unknown> | null;
    const sourceStations = payload?.stations ?? payload?.alerts;
    const alerts = normalizeAirQualityStations(sourceStations) as AirQualityAlert[];
    return {
      alerts,
      fetchedAt: normalizeAirQualityFetchedAt(payload),
    };
  }, (out) => out.alerts.length);
};
