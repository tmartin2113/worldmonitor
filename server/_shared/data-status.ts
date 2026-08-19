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
  | 'DATA_AVAILABILITY_STALE'
  | 'DATA_AVAILABILITY_PARTIAL';

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

/**
 * Attach a data_status to a handler that reads ONE seeded key, without rewriting
 * its payload logic.
 *
 * Most handlers are shaped `try { const r = await getCachedJson(K, true); ...map...
 * } catch { ...empty... }`. The try/catch exists only to guard the cache read,
 * which `readSeeded` already handles — and the catch is what silently converted a
 * Redis fault into the same empty payload a quiet feed produces. This keeps the
 * mapping verbatim and supplies the envelope around it:
 *
 *   return attach(KEY, 'the X seeder needs X_API_KEY', (raw) => {
 *     const result = raw as FooResponse | null;
 *     return result || { entries: [] };
 *   });
 *
 * `count` refines OK vs EMPTY from what the handler actually returns; pass it when
 * the payload has an obvious primary collection.
 */
export async function attach<T extends object>(
  key: string,
  whenMissing: string,
  body: (raw: unknown) => T | Promise<T>,
  count?: (out: T) => number,
): Promise<T & { dataStatus: DataStatus }> {
  const read = await readSeeded(key, whenMissing);
  const out = await body(read.data);
  const status = count ? withCount(read.status, count(out)) : read.status;
  return { ...out, dataStatus: status };
}

/**
 * Read SEVERAL seeded keys and describe the composite honestly.
 *
 * A handler that reads 21 keys and answers with one status is the hard case:
 * collapsing a partial result into OK hides the gap, and collapsing it into
 * NEVER_SEEDED paints a mostly-working answer as broken. Both destroy the
 * distinction this envelope exists to preserve, so PARTIAL exists and names the
 * inputs that were missing.
 *
 * Precedence, strongest signal first:
 *   1. any key errored          -> UPSTREAM_ERROR  (a live fault outranks absence)
 *   2. no key present at all    -> NEVER_SEEDED
 *   3. some present, some not   -> PARTIAL, listing what is missing
 *   4. all present              -> OK
 *
 * `fetchedAt` is the OLDEST present timestamp, not the newest: a composite answer
 * is only as fresh as its stalest input, and reporting the newest would let one
 * freshly-seeded key vouch for twenty stale ones.
 */
export interface MultiRead {
  /** key -> unwrapped payload, for keys that were actually present. */
  values: Map<string, unknown>;
  status: DataStatus;
}

export async function readSeededMany(keys: string[], context: string): Promise<MultiRead> {
  const values = new Map<string, unknown>();
  const missing: string[] = [];
  const errored: string[] = [];
  let oldest = 0;

  const reads = await Promise.all(
    keys.map(async (k) => ({ key: k, read: await readSeeded(k, context) })),
  );

  for (const { key, read } of reads) {
    if (read.status.availability === 'DATA_AVAILABILITY_UPSTREAM_ERROR') { errored.push(key); continue; }
    if (!read.present) { missing.push(key); continue; }
    values.set(key, read.data);
    const at = Number(read.status.fetchedAt);
    if (Number.isFinite(at) && at > 0) oldest = oldest === 0 ? at : Math.min(oldest, at);
  }

  // Cap the list: `detail` is capped at 300 chars anyway, and a wall of 26 key
  // names is not more informative than the first few plus a count.
  const name = (list: string[]) =>
    list.length <= 5 ? list.join(', ') : `${list.slice(0, 5).join(', ')} and ${list.length - 5} more`;

  let status: DataStatus;
  if (errored.length) {
    status = { fetchedAt: String(oldest), availability: 'DATA_AVAILABILITY_UPSTREAM_ERROR',
               detail: sanitizeDetail(`${errored.length} of ${keys.length} inputs could not be read (${name(errored)}) — a read failure, not an absence of data`) };
  } else if (values.size === 0) {
    status = { fetchedAt: '0', availability: 'DATA_AVAILABILITY_NEVER_SEEDED',
               detail: sanitizeDetail(`none of the ${keys.length} inputs has ever been written — ${context}`) };
  } else if (missing.length) {
    status = { fetchedAt: String(oldest), availability: 'DATA_AVAILABILITY_PARTIAL',
               detail: sanitizeDetail(`${missing.length} of ${keys.length} inputs missing (${name(missing)}); the rest were read normally`) };
  } else {
    status = { fetchedAt: String(oldest), availability: 'DATA_AVAILABILITY_OK', detail: '' };
  }
  return { values, status };
}

/**
 * A running tally for handlers that read MANY keys, often computed inside loops
 * so no static key list exists (list-temporal-anomalies reads a snapshot, then a
 * key per source, then a baseline key per type).
 *
 * Swap `await getCachedJson(k, true)` for `await tally.read(k)` at each call
 * site — same return value, `null` when absent — then hand `tally.status()` to
 * the response. Same precedence as readSeededMany: a live error outranks
 * absence, nothing-present is NEVER_SEEDED, some-present is PARTIAL naming what
 * was missing, all-present is OK. `fetchedAt` is the OLDEST input, because a
 * composite is only as fresh as its stalest part.
 *
 * Keys marked optional do not count against PARTIAL — an enrichment lookup that
 * legitimately has no row should not make the whole answer look degraded.
 */
export interface CacheTally {
  read<T = unknown>(key: string, opts?: { optional?: boolean }): Promise<T | null>;
  status(): DataStatus;
}

export function cacheTally(context: string): CacheTally {
  const missing: string[] = [];
  const errored: string[] = [];
  let present = 0;
  let oldest = 0;

  return {
    async read<T = unknown>(key: string, opts?: { optional?: boolean }): Promise<T | null> {
      const r = await readSeeded<T>(key, context);
      if (r.status.availability === 'DATA_AVAILABILITY_UPSTREAM_ERROR') {
        if (!opts?.optional) errored.push(key);
        return null;
      }
      if (!r.present) {
        if (!opts?.optional) missing.push(key);
        return null;
      }
      present += 1;
      const at = Number(r.status.fetchedAt);
      if (Number.isFinite(at) && at > 0) oldest = oldest === 0 ? at : Math.min(oldest, at);
      return r.data;
    },
    status(): DataStatus {
      const total = present + missing.length + errored.length;
      const name = (l: string[]) =>
        l.length <= 5 ? l.join(', ') : `${l.slice(0, 5).join(', ')} and ${l.length - 5} more`;
      if (errored.length) {
        return { fetchedAt: String(oldest), availability: 'DATA_AVAILABILITY_UPSTREAM_ERROR',
                 detail: sanitizeDetail(`${errored.length} of ${total} inputs could not be read (${name(errored)}) — a read failure, not an absence of data`) };
      }
      if (total === 0) {
        return { fetchedAt: '0', availability: 'DATA_AVAILABILITY_OK', detail: 'answered without reading any cached input' };
      }
      if (present === 0) {
        return { fetchedAt: '0', availability: 'DATA_AVAILABILITY_NEVER_SEEDED',
                 detail: sanitizeDetail(`none of the ${total} inputs has ever been written — ${context}`) };
      }
      if (missing.length) {
        return { fetchedAt: String(oldest), availability: 'DATA_AVAILABILITY_PARTIAL',
                 detail: sanitizeDetail(`${missing.length} of ${total} inputs missing (${name(missing)}); the rest were read normally`) };
      }
      return { fetchedAt: String(oldest), availability: 'DATA_AVAILABILITY_OK', detail: '' };
    },
  };
}

/** attach() for the multi-key case: same contract, composite status. */
export async function attachMany<T extends object>(
  keys: string[],
  context: string,
  body: (values: Map<string, unknown>) => T | Promise<T>,
): Promise<T & { dataStatus: DataStatus }> {
  const read = await readSeededMany(keys, context);
  const out = await body(read.values);
  return { ...out, dataStatus: read.status };
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
