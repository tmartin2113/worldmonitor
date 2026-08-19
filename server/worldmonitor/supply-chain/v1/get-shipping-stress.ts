import type {
  SupplyChainServiceHandler,
  ServerContext,
  GetShippingStressRequest,
  GetShippingStressResponse,
} from '../../../../src/generated/server/worldmonitor/supply_chain/v1/service_server';

import { attach } from '../../../_shared/data-status';

const REDIS_KEY = 'supply_chain:shipping_stress:v1';

export const getShippingStress: SupplyChainServiceHandler['getShippingStress'] = async (
  _ctx: ServerContext,
  _req: GetShippingStressRequest,
): Promise<GetShippingStressResponse> => {
  return attach(REDIS_KEY, 'the shipping-stress seeder has not written this key', (raw) => {
    const data = raw as GetShippingStressResponse | null;
    return data ?? { carriers: [], stressScore: 0, stressLevel: 'low', fetchedAt: 0, upstreamUnavailable: true };
  }, (out) => out.carriers.length);
};
