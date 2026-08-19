import type {
  ServerContext,
  GetAircraftDetailsRequest,
  GetAircraftDetailsResponse,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';

import {
  AIRCRAFT_DETAILS_CACHE_KEY,
  AIRCRAFT_DETAILS_CACHE_TTL,
  type CachedAircraftDetails,
  fetchWingbitsAircraftDetails,
} from './_wingbits-aircraft-details';
import { cachedFetchJson } from '../../../_shared/redis';
import { answeredDirectly, neverSeeded, upstreamError } from '../../../_shared/data-status';

export async function getAircraftDetails(
  _ctx: ServerContext,
  req: GetAircraftDetailsRequest,
): Promise<GetAircraftDetailsResponse> {
  if (!req.icao24) {
    return {
      details: undefined,
      configured: false,
      dataStatus: { fetchedAt: '0', availability: 'DATA_AVAILABILITY_EMPTY', detail: 'no icao24 supplied; nothing was looked up' },
    };
  }
  const apiKey = process.env.WINGBITS_API_KEY;
  // No key means no fetch was ever attempted — a provisioning gap, which is not
  // the same as "this aircraft has no details".
  if (!apiKey) {
    return {
      details: undefined,
      configured: false,
      dataStatus: neverSeeded('WINGBITS_API_KEY is not set, so no aircraft lookup was attempted'),
    };
  }

  const icao24 = req.icao24.toLowerCase();
  const cacheKey = `${AIRCRAFT_DETAILS_CACHE_KEY}:${icao24}`;

  try {
    const result = await cachedFetchJson<CachedAircraftDetails>(
      cacheKey,
      AIRCRAFT_DETAILS_CACHE_TTL,
      async () => fetchWingbitsAircraftDetails(icao24, apiKey),
    );

    if (!result || !result.details) {
      return {
        details: undefined,
        configured: true,
        dataStatus: {
          fetchedAt: '0',
          availability: 'DATA_AVAILABILITY_EMPTY',
          detail: 'Wingbits returned no details for this aircraft',
        },
      };
    }

    return {
      details: result.details,
      configured: true,
      dataStatus: answeredDirectly(),
    };
  } catch (err) {
    // cachedFetchJson rethrows fetcher failures, so this is a real fault —
    // previously indistinguishable from "no such aircraft".
    return {
      details: undefined,
      configured: true,
      dataStatus: upstreamError(err, 'Wingbits aircraft lookup failed'),
    };
  }
}
