import type {
  ServerContext,
  ListSecurityAdvisoriesRequest,
  ListSecurityAdvisoriesResponse,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { attach } from '../../../_shared/data-status';

const ADVISORY_KEY = 'intelligence:advisories:v1';

export async function listSecurityAdvisories(
  _ctx: ServerContext,
  _req: ListSecurityAdvisoriesRequest,
): Promise<ListSecurityAdvisoriesResponse> {
  return attach(ADVISORY_KEY, 'the security-advisory seeder has not written this key', (cached) => {
    const data = cached as {
      advisories: Array<{ title: string; link: string; pubDate: string; source: string; sourceCountry: string; level: string; country: string }>;
      byCountry: Record<string, string>;
    } | null;

    if (data?.advisories?.length) {
      return {
        advisories: data.advisories.map(a => ({
          title: a.title,
          link: a.link,
          pubDate: a.pubDate,
          source: a.source,
          sourceCountry: a.sourceCountry,
          level: a.level,
          country: a.country,
        })),
        byCountry: data.byCountry || {},
      };
    }

    return { advisories: [], byCountry: {} };
  }, (out) => out.advisories.length);
}
