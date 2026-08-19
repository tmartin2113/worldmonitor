/**
 * ListInternetOutages RPC -- reads seeded outage data from Railway seed cache.
 * All external Cloudflare Radar API calls happen in seed-internet-outages.mjs on Railway.
 */

import type {
  ServerContext,
  ListInternetOutagesRequest,
  ListInternetOutagesResponse,
  InternetOutage,
} from '../../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';

import { readSeeded, withCount } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'infra:outages:v1';

function filterOutages(outages: InternetOutage[], req: ListInternetOutagesRequest): InternetOutage[] {
  let filtered = outages;
  if (req.country) {
    const target = req.country.toLowerCase();
    filtered = filtered.filter((o) => o.country.toLowerCase().includes(target));
  }
  if (req.start) {
    filtered = filtered.filter((o) => o.detectedAt >= req.start);
  }
  if (req.end) {
    filtered = filtered.filter((o) => o.detectedAt <= req.end);
  }
  return filtered;
}

export async function listInternetOutages(
  _ctx: ServerContext,
  req: ListInternetOutagesRequest,
): Promise<ListInternetOutagesResponse> {
  const read = await readSeeded<ListInternetOutagesResponse>(
    SEED_CACHE_KEY,
    'seed-internet-outages.mjs has not run (Cloudflare Radar requires a token). An empty list is not a claim that the internet is healthy everywhere.',
  );
  const outages = filterOutages(read.data?.outages || [], req);
  return { outages, pagination: undefined, dataStatus: withCount(read.status, outages.length) };
}
