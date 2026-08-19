/**
 * ListEarthquakes RPC -- reads seeded earthquake data from Railway seed cache.
 * All external USGS API calls happen in seed-earthquakes.mjs on Railway.
 */

import type {
  SeismologyServiceHandler,
  ServerContext,
  ListEarthquakesRequest,
  ListEarthquakesResponse,
} from '../../../../src/generated/server/worldmonitor/seismology/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'seismology:earthquakes:v1';

type EarthquakeCache = { earthquakes: ListEarthquakesResponse['earthquakes'] };

export const listEarthquakes: SeismologyServiceHandler['listEarthquakes'] = async (
  _ctx: ServerContext,
  req: ListEarthquakesRequest,
): Promise<ListEarthquakesResponse> => {
  const pageSize = req.pageSize || 500;
  return attach(SEED_CACHE_KEY, 'the seeder for list earthquakes has not written this key', (raw) => {
    const seedData = raw as EarthquakeCache | null;
    const earthquakes = seedData?.earthquakes || [];
    return { earthquakes: earthquakes.slice(0, pageSize), pagination: undefined };
  });
};
