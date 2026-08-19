import type {
  ServerContext,
  GetCustomsRevenueRequest,
  GetCustomsRevenueResponse,
} from '../../../../src/generated/server/worldmonitor/trade/v1/service_server';

import { attach } from '../../../_shared/data-status';

const CUSTOMS_KEY = 'trade:customs-revenue:v1';

export async function getCustomsRevenue(
  _ctx: ServerContext,
  _req: GetCustomsRevenueRequest,
): Promise<GetCustomsRevenueResponse> {
  return attach(CUSTOMS_KEY, 'the customs-revenue seeder has not written this key', (cached) => {
    const data = cached as GetCustomsRevenueResponse | null;
    if (data?.months?.length) return data;
    return { months: [], fetchedAt: new Date().toISOString(), upstreamUnavailable: true };
  }, (out) => out.months.length);
}
