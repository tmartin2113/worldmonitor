/**
 * RPC: ListCryptoSectors -- reads seeded crypto sector data from Railway seed cache.
 */

import type {
  ServerContext,
  ListCryptoSectorsRequest,
  ListCryptoSectorsResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'market:crypto-sectors:v1';

export async function listCryptoSectors(
  _ctx: ServerContext,
  _req: ListCryptoSectorsRequest,
): Promise<ListCryptoSectorsResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for list crypto sectors has not written this key', (__cachedValue) => {
    const seedData = __cachedValue as { sectors: Array<{ id: string; name: string; change: number }> } | null;
    if (!seedData?.sectors?.length) return { sectors: [] };
    return { sectors: seedData.sectors };
  });
}
