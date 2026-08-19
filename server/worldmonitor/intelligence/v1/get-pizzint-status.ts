import type {
  ServerContext,
  GetPizzintStatusRequest,
  GetPizzintStatusResponse,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_KEY = 'intelligence:pizzint:seed:v1';

export async function getPizzintStatus(
  _ctx: ServerContext,
  req: GetPizzintStatusRequest,
): Promise<GetPizzintStatusResponse> {
  return attach(SEED_KEY, 'the seeder for get pizzint status has not written this key', (raw) => {
    const result = raw as GetPizzintStatusResponse | null;
    if (!result?.pizzint) return { pizzint: undefined, tensionPairs: [] };
    return req.includeGdelt ? result : { pizzint: result.pizzint, tensionPairs: [] };
  });
}
