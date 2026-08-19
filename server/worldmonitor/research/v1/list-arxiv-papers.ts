/**
 * RPC: listArxivPapers -- reads seeded arXiv data from Railway seed cache.
 * All external arXiv API calls happen in seed-research.mjs on Railway.
 */

import type {
  ServerContext,
  ListArxivPapersRequest,
  ListArxivPapersResponse,
} from '../../../../src/generated/server/worldmonitor/research/v1/service_server';

import { clampInt } from '../../../_shared/constants';
import { readSeeded, withCount } from '../../../_shared/data-status';

const SEED_KEY_PREFIX = 'research:arxiv:v1';

export async function listArxivPapers(
  _ctx: ServerContext,
  req: ListArxivPapersRequest,
): Promise<ListArxivPapersResponse> {
  const category = req.category || 'cs.AI';
  const pageSize = clampInt(req.pageSize, 50, 1, 100);
  const read = await readSeeded<ListArxivPapersResponse>(
    `${SEED_KEY_PREFIX}:${category}::50`,
    `seed-research.mjs has not written arXiv category "${category}".`,
  );
  const papers = (read.data?.papers ?? []).slice(0, pageSize);
  return { papers, pagination: undefined, dataStatus: withCount(read.status, papers.length) };
}
