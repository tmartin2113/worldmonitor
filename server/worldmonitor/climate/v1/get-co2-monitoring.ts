import type {
  ClimateServiceHandler,
  ServerContext,
  GetCo2MonitoringRequest,
  GetCo2MonitoringResponse,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import { CLIMATE_CO2_MONITORING_KEY } from '../../../_shared/cache-keys';
import { attach } from '../../../_shared/data-status';

export const getCo2Monitoring: ClimateServiceHandler['getCo2Monitoring'] = async (
  _ctx: ServerContext,
  _req: GetCo2MonitoringRequest,
): Promise<GetCo2MonitoringResponse> => {
  return attach(CLIMATE_CO2_MONITORING_KEY, 'the CO2 monitoring seeder has not written this key',
    (cached) => (cached as GetCo2MonitoringResponse | null) ?? {});
};
