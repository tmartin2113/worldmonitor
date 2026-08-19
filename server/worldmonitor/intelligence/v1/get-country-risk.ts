import type {
  ServerContext,
  GetCountryRiskRequest,
  GetCountryRiskResponse,
  CiiScore,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { ValidationError } from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { CII_RISK_SCORE_CACHE_KEYS } from '../../../_shared/cache-keys';
import { TIER1_COUNTRIES } from './_shared';

const RISK_SCORES_KEY = CII_RISK_SCORE_CACHE_KEYS.stale;
const ADVISORIES_KEY = 'intelligence:advisories:v1';
// Full ISO2 → entryCount map across all OFAC entries (not the top-12 summary slice).
const SANCTIONS_COUNTS_KEY = 'sanctions:country-counts:v1';
const UNKNOWN_CII_COMPUTED_AT = 0;

function resolveCountryName(
  code: string,
  byCountryName: Record<string, string> | undefined,
): string {
  return TIER1_COUNTRIES[code] ?? byCountryName?.[code] ?? code;
}

export async function getCountryRisk(
  _ctx: ServerContext,
  req: GetCountryRiskRequest,
): Promise<GetCountryRiskResponse> {
  const code = req.countryCode?.toUpperCase() ?? '';

  // ENFORCE THE CONTRACT THE PROTO ALREADY DECLARES. get_country_risk.proto
  // marks country_code required, len = 2, pattern ^[A-Z]{2}$ — but nothing
  // enforced it here, so a missing or malformed code fell through to a response
  // of sanctionsActive:false / sanctionsCount:0 / upstreamUnavailable:FALSE.
  //
  // That is not a null answer, it is a confident wrong one: it states that the
  // country has no sanctions and that every upstream was reachable. Found
  // 2026-08-18 while probing with `?country=RU` instead of `?country_code=RU` —
  // the endpoint reported Russia clean, and the payload gave no hint that it had
  // simply never been told which country to look up.
  //
  // ValidationError is the mechanism sibling endpoints already use
  // (list-company-signals, get-company-enrichment) and surfaces as a 400.
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new ValidationError([
      {
        field: 'country_code',
        description:
          'country_code is required and must be an ISO 3166-1 alpha-2 code (two letters, e.g. "RU").',
      },
    ]);
  }

  const [riskRaw, advisoriesRaw, sanctionsRaw] = await Promise.all([
    getCachedJson(RISK_SCORES_KEY, true),
    getCachedJson(ADVISORIES_KEY, true),
    getCachedJson(SANCTIONS_COUNTS_KEY, true),
  ]);

  // Any missing upstream key: fail closed to prevent CDN-caching of partial
  // data as if it were valid (e.g. sanctionsActive:false or cii:undefined when
  // the Redis key itself is simply absent, not just untracked for this country).
  if (sanctionsRaw === null || riskRaw === null || advisoriesRaw === null) {
    return {
      countryCode: code,
      countryName: resolveCountryName(code, (advisoriesRaw as any)?.byCountryName),
      cii: undefined,
      advisoryLevel: '',
      sanctionsActive: false,
      sanctionsCount: 0,
      fetchedAt: UNKNOWN_CII_COMPUTED_AT,
      upstreamUnavailable: true,
    };
  }

  const ciiScores: CiiScore[] = (riskRaw as any)?.ciiScores ?? [];
  const cii = ciiScores.find((s) => s.region === code);

  const byCountry: Record<string, string> = (advisoriesRaw as any)?.byCountry ?? {};
  const advisoryLevel = byCountry[code] ?? '';

  const byCountryName: Record<string, string> | undefined = (advisoriesRaw as any)?.byCountryName;

  const sanctionsCount = (sanctionsRaw as Record<string, number>)[code] ?? 0;

  return {
    countryCode: code,
    countryName: resolveCountryName(code, byCountryName),
    cii,
    advisoryLevel,
    sanctionsActive: sanctionsCount > 0,
    sanctionsCount,
    fetchedAt: cii?.computedAt ?? UNKNOWN_CII_COMPUTED_AT,
    upstreamUnavailable: false,
  };
}
