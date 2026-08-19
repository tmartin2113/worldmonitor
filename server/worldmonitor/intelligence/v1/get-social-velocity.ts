import type {
  IntelligenceServiceHandler,
  ServerContext,
  GetSocialVelocityRequest,
  GetSocialVelocityResponse,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { attach } from '../../../_shared/data-status';

const REDIS_KEY = 'intelligence:social:reddit:v1';

export const getSocialVelocity: IntelligenceServiceHandler['getSocialVelocity'] = async (
  _ctx: ServerContext,
  _req: GetSocialVelocityRequest,
): Promise<GetSocialVelocityResponse> => {
  return attach(REDIS_KEY, 'the social-velocity seeder has not written this key', (raw) => {
    const data = raw as GetSocialVelocityResponse | null;
    return data ?? { posts: [], fetchedAt: 0 };
  }, (out) => out.posts.length);
};
