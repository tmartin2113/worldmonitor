import type {
  ServerContext,
  GetCountryPortActivityRequest,
  CountryPortActivityResponse,
  PortActivityEntry,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { cacheTally } from '../../../_shared/data-status';
import {
  PORTWATCH_PORT_ACTIVITY_COUNTRIES_KEY,
  PORTWATCH_PORT_ACTIVITY_KEY_PREFIX,
} from '../../../_shared/cache-keys';

interface SeederPort {
  portId?: string | null;
  portName?: string | null;
  lat?: number | null;
  lon?: number | null;
  tankerCalls30d?: number | null;
  trendDelta?: number | null;
  importTankerDwt30d?: number | null;
  exportTankerDwt30d?: number | null;
  anomalySignal?: boolean | null;
}

interface SeederPayload {
  iso2?: string | null;
  ports?: SeederPort[] | null;
  fetchedAt?: string | null;
}

const EMPTY: CountryPortActivityResponse = {
  available: false,
  ports: [],
  fetchedAt: '',
};

export async function getCountryPortActivity(
  _ctx: ServerContext,
  req: GetCountryPortActivityRequest,
): Promise<CountryPortActivityResponse> {
  const code = req.countryCode?.trim().toUpperCase() ?? '';
  if (!code || code.length !== 2) {
    return { ...EMPTY, dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'a 2-letter country_code is required; nothing was looked up' } };
  }

  // Both reads used `.catch(() => null)`, folding a Redis fault into the same
  // EMPTY returned for a country PortWatch does not cover.
  const tally = cacheTally('the PortWatch seeder has not written this key');
  const countriesResult = await tally.read(PORTWATCH_PORT_ACTIVITY_COUNTRIES_KEY);
  const countries = Array.isArray(countriesResult) ? (countriesResult as string[]) : [];
  if (!countries.includes(code)) {
    return {
      ...EMPTY,
      dataStatus: countries.length
        ? { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: `PortWatch does not cover ${code}` }
        : tally.status(),
    };
  }

  const data = await tally.read(`${PORTWATCH_PORT_ACTIVITY_KEY_PREFIX}${code}`);
  if (!data) return { ...EMPTY, dataStatus: tally.status() };

  const payload = data as SeederPayload;
  const rawPorts = Array.isArray(payload.ports) ? payload.ports : [];
  const topPorts = rawPorts.slice(0, 25);

  const ports: PortActivityEntry[] = topPorts.map((p) => {
    const calls30d = typeof p.tankerCalls30d === 'number' ? Math.round(p.tankerCalls30d) : 0;

    return {
      portId: p.portId ?? '',
      portName: p.portName ?? '',
      lat: typeof p.lat === 'number' ? p.lat : 0,
      lon: typeof p.lon === 'number' ? p.lon : 0,
      tankerCalls30d: calls30d,
      trendDeltaPct: typeof p.trendDelta === 'number' ? p.trendDelta : 0,
      importTankerDwt: typeof p.importTankerDwt30d === 'number' ? p.importTankerDwt30d : 0,
      exportTankerDwt: typeof p.exportTankerDwt30d === 'number' ? p.exportTankerDwt30d : 0,
      anomalySignal: p.anomalySignal === true,
    };
  });

  return {
    available: true,
    ports,
    fetchedAt: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : '',
    dataStatus: tally.status(),
  };
}
