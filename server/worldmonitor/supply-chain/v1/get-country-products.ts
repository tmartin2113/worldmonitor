import type {
  ServerContext,
  GetCountryProductsRequest,
  GetCountryProductsResponse,
  CountryProduct,
} from '../../../../src/generated/server/worldmonitor/supply_chain/v1/service_server';
import { ValidationError } from '../../../../src/generated/server/worldmonitor/supply_chain/v1/service_server';

import { isCallerPremium } from '../../../_shared/premium-check';
import { attach, neverSeeded } from '../../../_shared/data-status';

interface BilateralHs4Payload {
  iso2: string;
  products?: CountryProduct[];
  fetchedAt?: string;
}

export async function getCountryProducts(
  ctx: ServerContext,
  req: GetCountryProductsRequest,
): Promise<GetCountryProductsResponse> {
  const iso2 = (req.iso2 ?? '').trim().toUpperCase();

  // Input-shape errors return 400 — restoring the legacy /api/supply-chain/v1/
  // country-products contract which predated the sebuf migration. Empty-payload-200
  // is reserved for the PRO-gate deny path (intentional contract shift), not for
  // caller bugs (malformed/missing fields). Distinguishing the two matters for
  // logging, external API consumers, and silent-failure detection.
  if (!/^[A-Z]{2}$/.test(iso2)) {
    throw new ValidationError([{ field: 'iso2', description: 'iso2 must be a 2-letter uppercase ISO country code' }]);
  }

  const isPro = await isCallerPremium(ctx.request);
  const empty: GetCountryProductsResponse = { iso2, products: [], fetchedAt: '' };
  // Entitlement, not absence — the PRO-gate deny path deliberately returns an
  // empty 200, so it must say WHY or it reads as "this country has no products".
  if (!isPro) {
    return { ...empty, dataStatus: neverSeeded('country product detail requires a premium caller; no lookup was performed') };
  }

  // Seeder writes via raw key (no env-prefix) — match it on read.
  // The old `.catch(() => null)` folded a Redis fault into the same empty this
  // returns for an unseeded country.
  return attach(`comtrade:bilateral-hs4:${iso2}:v1`,
    `the Comtrade bilateral-HS4 seeder has not written ${iso2}`, (raw) => {
      const payload = raw as BilateralHs4Payload | null;
      if (!payload) return empty;
      return {
        iso2,
        products: Array.isArray(payload.products) ? payload.products : [],
        fetchedAt: payload.fetchedAt ?? '',
      };
    }, (out) => out.products.length);
}
