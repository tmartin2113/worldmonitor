import type {
  Forecast,
  ForecastServiceHandler,
  ServerContext,
  GetForecastsRequest,
  GetForecastsResponse,
} from '../../../../src/generated/server/worldmonitor/forecast/v1/service_server';
import filterParamContracts from '../../../../shared/openapi-filter-param-contracts.json';
import { readSeeded, withCount } from '../../../_shared/data-status';

const REDIS_KEY = 'forecast:predictions:v2';
const FORECAST_DOMAINS = new Set(filterParamContracts.forecastDomains);

export const getForecasts: ForecastServiceHandler['getForecasts'] = async (
  _ctx: ServerContext,
  req: GetForecastsRequest,
): Promise<GetForecastsResponse> => {
  const read = await readSeeded<{ predictions: Forecast[]; generatedAt: number }>(
    REDIS_KEY, 'the forecast engine has not written a prediction set');
  const failed = read.status.availability === 'DATA_AVAILABILITY_UPSTREAM_ERROR';
  const data = read.data;

  // `degraded` already meant "the read itself failed", which is the same
  // distinction data_status draws — so it is now derived from the read rather
  // than from which catch block happened to run.
  if (!data?.predictions) {
    return {
      forecasts: [], generatedAt: 0, degraded: failed, stale: false,
      error: failed ? 'forecast_backend_unavailable' : '',
      dataStatus: read.status,
    };
  }

  let forecasts = data.predictions;
  if (req.domain) {
    if (!FORECAST_DOMAINS.has(req.domain)) {
      return {
        forecasts: [], generatedAt: data.generatedAt || 0, degraded: false, stale: false, error: '',
        dataStatus: {
          fetchedAt: read.status.fetchedAt,
          availability: 'DATA_AVAILABILITY_EMPTY',
          detail: `"${req.domain}" is not a forecast domain; nothing was matched`,
        },
      };
    }
    forecasts = forecasts.filter(f => f.domain === req.domain);
  }
  if (req.region) forecasts = forecasts.filter(f => f.region.toLowerCase().includes(req.region.toLowerCase()));

  return {
    forecasts, generatedAt: data.generatedAt || 0, degraded: false, stale: false, error: '',
    dataStatus: withCount(read.status, forecasts.length),
  };
};
