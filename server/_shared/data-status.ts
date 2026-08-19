/**
 * Builds the `data_status` envelope that makes an EMPTY RESPONSE FALSIFIABLE.
 *
 * Measured 2026-08-19: 25 of 147 WorldMonitor endpoints answered 200 with a bare
 * `{}` or `{"events":[]}` — no timestamp, no status. `get-fred-series` returning
 * `{}` is indistinguishable from "FRED has no such series" and "we hold no key
 * and never fetched". Every data-integrity defect found on this box that month
 * was that shape, and none of them errored.
 *
 * The states are derived, never guessed:
 *   · cache MISS            -> NEVER_SEEDED    (nothing was ever written)
 *   · cache read ERROR      -> UPSTREAM_ERROR  (a live fault, not an absence)
 *   · `_seed.state==ERROR`  -> UPSTREAM_ERROR  (the seeder itself reported failure)
 *   · `_seed.state==OK_ZERO`-> EMPTY           (fetched, genuinely nothing)
 *   · payload present       -> OK / EMPTY by record count
 *
 * Distinguishing MISS from ERROR is the whole point and it is why this is built
 * on `readSeededCache` rather than `getCachedJson` — the latter returns `null`
 * for both, which is the very conflation this envelope exists to end.
 */

import { readSeededCache } from './redis';
import type { SeedMeta } from './seed-envelope';

export type DataAvailability =
  | 'DATA_AVAILABILITY_UNSPECIFIED'
  | 'DATA_AVAILABILITY_OK'
  | 'DATA_AVAILABILITY_EMPTY'
  | 'DATA_AVAILABILITY_NEVER_SEEDED'
  | 'DATA_AVAILABILITY_UPSTREAM_ERROR'
  | 'DATA_AVAILABILITY_STALE';

/**
 * Structurally identical to the generated `DataStatus` in all 11 domains, so a
 * value of this type is assignable to any of them without importing 11 copies.
 * `fetchedAt` is a string because proto int64 maps to string in the generated TS.
 */
export interface DataStatus {
  fetchedAt: string;
  availability: DataAvailability;
  detail: string;
}

/**
 * `detail` is surfaced to API consumers, and seeder `errorReason` strings can
 * embed the URL that failed. server/error-mapper.ts genericises 5xx messages on
 * purpose (H-3) precisely so upstream URLs and key fragments never leak through
 * an error path; this field must not become a way around that. Strip URLs and
 * anything that looks like a credential, and cap the length.
 */
export function sanitizeDetail(input: unknown): string {
  if (typeof input !== 'string' || !input) return '';
  return input
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, '<url>')
    .replace(/\b(?:api[_-]?key|token|secret|password|bearer|authorization)\b\s*[=:]\s*\S+/gi, '<redacted>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<redacted>')
    .slice(0, 300)
    .trim();
}

function fetchedAtOf(seed: SeedMeta | null, payload: unknown): string {
  if (seed && typeof seed.fetchedAt === 'number' && seed.fetchedAt > 0) return String(seed.fetchedAt);
  const p = payload as { fetchedAt?: unknown; generatedAt?: unknown } | null | undefined;
  const own = p?.fetchedAt ?? p?.generatedAt;
  if (typeof own === 'number' && own > 0) return String(own);
  if (typeof own === 'string' && /^\d+$/.test(own)) return own;
  return '0';
}

export interface SeededRead<T> {
  /** Unwrapped payload, or null when the key was missing or unreadable. */
  data: T | null;
  /** Envelope for the response. Callers refine OK/EMPTY via `withCount`. */
  status: DataStatus;
  /** True only when a value was actually read. Distinguishes "empty" from "absent". */
  present: boolean;
}

/**
 * Read a seeded cache key and describe what came back.
 *
 * @param key      the seed key, read raw (seeders bypass the env-prefix scheme)
 * @param whenMissing explanation for NEVER_SEEDED — say WHY, e.g. which
 *        credential the seeder is blocked on. A bare "no data" helps nobody.
 */
export async function readSeeded<T = unknown>(
  key: string,
  whenMissing: string,
): Promise<SeededRead<T>> {
  let read;
  try {
    read = await readSeededCache(key, true);
  } catch (err) {
    // readSeededCache catches internally, but a caller must never be handed a
    // throw that turns into a bare empty by an outer catch.
    return {
      data: null,
      present: false,
      status: {
        fetchedAt: '0',
        availability: 'DATA_AVAILABILITY_UPSTREAM_ERROR',
        detail: sanitizeDetail(`cache read failed: ${(err as Error)?.message ?? 'unknown'}`),
      },
    };
  }

  if (read.status === 'miss') {
    return {
      data: null,
      present: false,
      status: {
        fetchedAt: '0',
        availability: 'DATA_AVAILABILITY_NEVER_SEEDED',
        detail: sanitizeDetail(`${key} has never been written — ${whenMissing}`),
      },
    };
  }

  if (read.status === 'error') {
    return {
      data: null,
      present: false,
      status: {
        fetchedAt: '0',
        availability: 'DATA_AVAILABILITY_UPSTREAM_ERROR',
        detail: sanitizeDetail(
          `${key} could not be read: ${(read.error as Error)?.message ?? 'unknown'} — a read failure, not an absence of data`,
        ),
      },
    };
  }

  const seed = read.seed;
  const fetchedAt = fetchedAtOf(seed, read.value);

  // The seeder's own verdict outranks anything inferred from payload shape: it
  // is the only party that knows whether the fetch succeeded.
  if (seed?.state === 'ERROR') {
    return {
      data: read.value as T,
      present: true,
      status: {
        fetchedAt,
        availability: 'DATA_AVAILABILITY_UPSTREAM_ERROR',
        detail: sanitizeDetail(seed.errorReason ?? 'the seeder reported a failed fetch'),
      },
    };
  }

  return {
    data: read.value as T,
    present: true,
    status: {
      fetchedAt,
      availability: seed?.state === 'OK_ZERO'
        ? 'DATA_AVAILABILITY_EMPTY'
        : 'DATA_AVAILABILITY_OK',
      detail: '',
    },
  };
}

/**
 * Refine a successful read's OK/EMPTY by the count the handler actually returns
 * (after its own filtering). A read that hit but yields zero rows to THIS caller
 * is EMPTY, and that is a real answer — not to be confused with NEVER_SEEDED.
 * Leaves NEVER_SEEDED / UPSTREAM_ERROR untouched.
 */
export function withCount(status: DataStatus, count: number): DataStatus {
  if (
    status.availability !== 'DATA_AVAILABILITY_OK' &&
    status.availability !== 'DATA_AVAILABILITY_EMPTY'
  ) return status;
  return {
    ...status,
    availability: count > 0 ? 'DATA_AVAILABILITY_OK' : 'DATA_AVAILABILITY_EMPTY',
  };
}

/** A handler that answered fully from its own inputs — no cache, no upstream. */
export function answeredDirectly(detail = ''): DataStatus {
  return { fetchedAt: '0', availability: 'DATA_AVAILABILITY_OK', detail: sanitizeDetail(detail) };
}

/** A live (non-seeded) fetch that threw. */
export function upstreamError(err: unknown, context: string): DataStatus {
  return {
    fetchedAt: '0',
    availability: 'DATA_AVAILABILITY_UPSTREAM_ERROR',
    detail: sanitizeDetail(`${context}: ${(err as Error)?.message ?? 'unknown'}`),
  };
}

/** A live fetch this deployment cannot make, e.g. a missing credential. */
export function neverSeeded(reason: string): DataStatus {
  return { fetchedAt: '0', availability: 'DATA_AVAILABILITY_NEVER_SEEDED', detail: sanitizeDetail(reason) };
}
