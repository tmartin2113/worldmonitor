/**
 * RPC: getEnergyCrisisPolicies -- reads seeded IEA energy crisis policy data from Redis cache.
 * All data comes from the seed-energy-crisis-policies.mjs seeder.
 */

import type {
  ServerContext,
  GetEnergyCrisisPoliciesRequest,
  GetEnergyCrisisPoliciesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'energy:crisis-policies:v1';

export async function getEnergyCrisisPolicies(
  _ctx: ServerContext,
  req: GetEnergyCrisisPoliciesRequest,
): Promise<GetEnergyCrisisPoliciesResponse> {
  return attach(SEED_CACHE_KEY, 'the energy-crisis-policy seeder has not written this key', (raw) => {
    const result = raw as GetEnergyCrisisPoliciesResponse | null;
    if (!result?.policies?.length) {
      return { source: '', sourceUrl: '', context: '', policies: [], updatedAt: '', unavailable: true };
    }
    let policies = result.policies;
    if (req.countryCode) {
      policies = policies.filter(p => p.countryCode === req.countryCode);
    }
    if (req.category) {
      policies = policies.filter(p => p.category === req.category);
    }
    return { ...result, policies, unavailable: false };
  }, (out) => out.policies.length);
}
