import type {
  ServerContext,
  GetCountryChokepointIndexRequest,
  GetCountryChokepointIndexResponse,
} from '../../../../src/generated/server/worldmonitor/supply_chain/v1/service_server';

import { getCachedJson, setCachedJson } from '../../../_shared/redis';
import { answeredDirectly, neverSeeded, upstreamError } from '../../../_shared/data-status';
import { isCallerPremium } from '../../../_shared/premium-check';
import { CHOKEPOINT_EXPOSURE_KEY } from '../../../_shared/cache-keys';
import { lazyFetchBilateralHs4 } from './_bilateral-hs4-lazy';
import {
  computeFlowWeightedExposures,
  computeFallbackExposures,
  vulnerabilityIndex,
  getRouteIdsForCountry,
  getCoastSide,
  type CountryProduct,
} from './chokepoint-exposure-utils';

const CACHE_TTL = 86400; // 24 hours
const TRANSIENT_CACHE_TTL = 60; // 60s when bilateral data is still loading

interface BilateralHs4Payload {
  iso2: string;
  products: CountryProduct[];
  fetchedAt: string;
}

interface BilateralResult {
  products: CountryProduct[] | null;
  transient: boolean;
}

async function loadBilateralProducts(iso2: string): Promise<BilateralResult> {
  const bilateralKey = `comtrade:bilateral-hs4:${iso2}:v1`;
  const rawPayload = await getCachedJson(bilateralKey, true).catch(() => null) as BilateralHs4Payload | null;
  if (rawPayload?.products?.length) return { products: rawPayload.products, transient: false };

  const lazyResult = await lazyFetchBilateralHs4(iso2);
  if (lazyResult && lazyResult.products.length > 0) return { products: lazyResult.products, transient: false };

  // Transient states: null = in-flight concurrent fetch, rateLimited = 429,
  // comtradeSource 'lazy' with no products = upstream server error / timeout
  const isTransient = lazyResult === null
    || lazyResult.rateLimited === true
    || (lazyResult.comtradeSource === 'lazy' && lazyResult.products.length === 0);
  return { products: null, transient: isTransient };
}

function emptyResponse(iso2: string, hs2: string): GetCountryChokepointIndexResponse {
  return {
    iso2,
    hs2,
    exposures: [],
    primaryChokepointId: '',
    vulnerabilityIndex: 0,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getCountryChokepointIndex(
  ctx: ServerContext,
  req: GetCountryChokepointIndexRequest,
): Promise<GetCountryChokepointIndexResponse> {
  const isPro = await isCallerPremium(ctx.request);
  if (!isPro) {
    return { ...emptyResponse(req.iso2, req.hs2 || '27'),
      dataStatus: neverSeeded('the chokepoint index requires a premium caller; nothing was computed') };
  }

  const iso2 = req.iso2.trim().toUpperCase();
  const hs2 = (req.hs2?.trim() || '27').replace(/\D/g, '') || '27';

  if (!/^[A-Z]{2}$/.test(iso2) || !/^\d{1,2}$/.test(hs2)) {
    return { ...emptyResponse(req.iso2, req.hs2 || '27'),
      dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'iso2 or hs2 was malformed; nothing was computed' } };
  }

  const cacheKey = CHOKEPOINT_EXPOSURE_KEY(iso2, hs2);

  try {
    const cached = await getCachedJson(cacheKey) as GetCountryChokepointIndexResponse | null;
    if (cached) return { ...cached, dataStatus: cached.dataStatus ?? answeredDirectly('served from the computed-result cache') };

    const { products, transient } = await loadBilateralProducts(iso2);

    let exposures;
    if (products) {
      exposures = computeFlowWeightedExposures(iso2, hs2, products);
    } else {
      exposures = computeFallbackExposures(getRouteIdsForCountry(iso2), hs2);
    }

    if (exposures.length === 0) {
      exposures = computeFallbackExposures(getRouteIdsForCountry(iso2), hs2);
    }

    const coastSide = getCoastSide(iso2);
    if (exposures[0]) exposures[0] = { ...exposures[0], coastSide };

    const primaryId = exposures[0]?.chokepointId ?? '';
    const vulnIndex = vulnerabilityIndex(exposures);

    const result: GetCountryChokepointIndexResponse = {
      iso2,
      hs2,
      exposures,
      primaryChokepointId: primaryId,
      vulnerabilityIndex: vulnIndex,
      fetchedAt: new Date().toISOString(),
    };

    // `products === null` means the exposures were computed from the coarse
    // route-based fallback rather than real bilateral trade data. That is a
    // materially weaker answer with the same shape, so it is PARTIAL — and
    // `transient` says the input was unreadable rather than simply unseeded.
    result.dataStatus = products
      ? answeredDirectly()
      : {
          fetchedAt: '0',
          availability: transient ? 'DATA_AVAILABILITY_UPSTREAM_ERROR' : 'DATA_AVAILABILITY_PARTIAL',
          detail: transient
            ? `bilateral trade data for ${iso2} could not be fetched; exposures fall back to route-based estimates`
            : `no bilateral trade data for ${iso2}; exposures are route-based estimates, not flow-weighted`,
        };

    const ttl = transient ? TRANSIENT_CACHE_TTL : CACHE_TTL;
    await setCachedJson(cacheKey, result, ttl);

    return result;
  } catch (err) {
    return { ...emptyResponse(iso2, hs2), dataStatus: upstreamError(err, 'chokepoint index computation failed') };
  }
}
