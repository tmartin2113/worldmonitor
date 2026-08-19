import type {
  ServerContext,
  ListDefensePatentsRequest,
  ListDefensePatentsResponse,
  DefensePatentFiling,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_KEY = 'patents:defense:latest';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listDefensePatents(
  _ctx: ServerContext,
  req: ListDefensePatentsRequest,
): Promise<ListDefensePatentsResponse> {
  return attach(SEED_KEY, 'the seeder for list defense patents has not written this key', (__cachedValue) => {
    const result = __cachedValue as { patents?: DefensePatentFiling[]; fetchedAt?: string } | null;
    if (!result?.patents?.length) {
      return { patents: [], total: 0, fetchedAt: '' };
    }

    const total = result.patents.length;
    let patents = result.patents;

    if (req.cpcCode) {
      const code = req.cpcCode.toUpperCase();
      patents = patents.filter((p) => p.cpcCode.startsWith(code));
    }
    if (req.assignee) {
      const kw = req.assignee.toLowerCase();
      patents = patents.filter((p) => p.assignee.toLowerCase().includes(kw));
    }

    const limit = req.limit > 0 ? Math.min(req.limit, MAX_LIMIT) : DEFAULT_LIMIT;
    patents = patents.slice(0, limit);

    return { patents, total, fetchedAt: result.fetchedAt ?? '' };
  });
}
