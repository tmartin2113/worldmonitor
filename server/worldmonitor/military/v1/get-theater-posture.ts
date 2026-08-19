import type {
  ServerContext,
  GetTheaterPostureRequest,
  GetTheaterPostureResponse,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';

import { readSeeded } from '../../../_shared/data-status';

const CACHE_KEY = 'theater-posture:sebuf:v1';
const STALE_CACHE_KEY = 'theater_posture:sebuf:stale:v1';
const BACKUP_CACHE_KEY = 'theater-posture:sebuf:backup:v1';

// All theater posture assembly (OpenSky + Wingbits + classification)
// happens on Railway (ais-relay.cjs seedTheaterPosture loop + seed-military-flights.mjs).
// This handler reads pre-built data from Redis only.
// Gold standard: Vercel reads, Railway writes.

export async function getTheaterPosture(
  _ctx: ServerContext,
  _req: GetTheaterPostureRequest,
): Promise<GetTheaterPostureResponse> {
  // A CASCADE, not a composite: live -> stale -> backup. PARTIAL would be the
  // wrong word here — every tier answers the same question, so falling through
  // to a lower tier means the answer is OLD, not incomplete. Serving the stale
  // snapshot and calling it OK is what made a frozen feed look healthy.
  const live = await readSeeded<GetTheaterPostureResponse>(
    CACHE_KEY, 'the theater-posture seeder has not written the live key');
  if (live.data?.theaters?.length) {
    return { theaters: live.data.theaters, dataStatus: live.status };
  }

  for (const [key, label] of [
    [STALE_CACHE_KEY, 'stale snapshot'],
    [BACKUP_CACHE_KEY, 'backup snapshot'],
  ] as const) {
    const fallback = await readSeeded<GetTheaterPostureResponse>(key, 'not written');
    if (fallback.data?.theaters?.length) {
      return {
        theaters: fallback.data.theaters,
        dataStatus: {
          fetchedAt: fallback.status.fetchedAt,
          availability: 'DATA_AVAILABILITY_STALE',
          detail: `live theater posture was unavailable; serving the ${label}`,
        },
      };
    }
  }

  return {
    theaters: [],
    // The live read's own verdict is the honest one — it says whether the key was
    // never written or could not be read, and neither fallback rescued it.
    dataStatus: live.status.availability === 'DATA_AVAILABILITY_UPSTREAM_ERROR'
      ? live.status
      : {
          fetchedAt: '0',
          availability: 'DATA_AVAILABILITY_NEVER_SEEDED',
          detail: 'no theater posture in the live, stale or backup keys',
        },
  };
}
