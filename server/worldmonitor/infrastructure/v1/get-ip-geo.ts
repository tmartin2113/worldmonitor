import type {
  InfrastructureServiceHandler,
  ServerContext,
  GetIpGeoRequest,
  GetIpGeoResponse,
} from '../../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';
import { answeredDirectly } from '../../../_shared/data-status';

/**
 * GetIpGeo returns geographic information based on the request headers (Cloudflare/Vercel).
 */
export const getIpGeo: InfrastructureServiceHandler['getIpGeo'] = async (
  ctx: ServerContext,
  _req: GetIpGeoRequest,
): Promise<GetIpGeoResponse> => {
  const headers = ctx.headers;
  const cfCountry = headers['cf-ipcountry'];
  const vercelCountry = headers['x-vercel-ip-country'];
  
  const country = (cfCountry && cfCountry !== 'T1' ? cfCountry : null) || vercelCountry || 'XX';
  
  // 'XX' is a placeholder meaning "this request carried no geo headers" — it is
  // not a country, and a consumer that cannot tell those apart will map it.
  const located = country !== 'XX';
  return {
    country,
    region: headers['x-vercel-ip-region'] || '',
    city: headers['x-vercel-ip-city'] || '',
    dataStatus: located
      ? answeredDirectly('geo resolved from edge request headers')
      : {
          fetchedAt: '0',
          availability: 'DATA_AVAILABILITY_EMPTY',
          detail: "this request carried no Cloudflare/Vercel geo headers, so location is unknown; country 'XX' is a placeholder, not a country",
        },
  };
};
