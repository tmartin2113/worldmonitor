/**
 * RPC: listTrendingRepos -- reads seeded trending repo data from Railway seed cache.
 * All external OSSInsight/GitHub API calls happen in seed-research.mjs on Railway.
 */

import type {
  ServerContext,
  ListTrendingReposRequest,
  ListTrendingReposResponse,
} from '../../../../src/generated/server/worldmonitor/research/v1/service_server';

import { clampInt } from '../../../_shared/constants';
import { attach } from '../../../_shared/data-status';

const SEED_KEY_PREFIX = 'research:trending:v1';

export async function listTrendingRepos(
  _ctx: ServerContext,
  req: ListTrendingReposRequest,
): Promise<ListTrendingReposResponse> {
  const language = req.language || 'python';
  const period = req.period || 'daily';
  const pageSize = clampInt(req.pageSize, 50, 1, 100);
  return attach(`${SEED_KEY_PREFIX}:${language}:${period}:50`,
    `seed-research.mjs has not written trending repos for ${language}/${period}`, (raw) => {
      const result = raw as ListTrendingReposResponse | null;
      if (!result?.repos?.length) return { repos: [], pagination: undefined };
      return { repos: result.repos.slice(0, pageSize), pagination: undefined };
    }, (out) => out.repos.length);
}
