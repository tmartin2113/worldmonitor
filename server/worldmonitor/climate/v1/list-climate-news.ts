/**
 * ListClimateNews RPC -- reads seeded climate news data from Railway seed cache.
 */

import type {
  ClimateServiceHandler,
  ServerContext,
  ListClimateNewsRequest,
  ListClimateNewsResponse,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import { attach } from '../../../_shared/data-status';
import { CLIMATE_NEWS_KEY } from '../../../_shared/cache-keys';

export const listClimateNews: ClimateServiceHandler['listClimateNews'] = async (
  _ctx: ServerContext,
  _req: ListClimateNewsRequest,
): Promise<ListClimateNewsResponse> => {
  return attach(CLIMATE_NEWS_KEY, 'the climate-news seeder has not written this key', (cached) => {
    const result = cached as ListClimateNewsResponse | null;
    return result ? { ...result, dataAvailable: true } : { items: [], fetchedAt: 0, dataAvailable: false };
  }, (out) => out.items.length);
};
