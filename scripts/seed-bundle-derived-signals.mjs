#!/usr/bin/env node
import { runBundle, MIN, HOUR } from './_bundle-runner.mjs';

await runBundle('derived-signals', [
  { label: 'Correlation', script: 'seed-correlation.mjs', seedMetaKey: 'correlation:cards', canonicalKey: 'correlation:cards-bootstrap:v1', intervalMs: 5 * MIN, timeoutMs: 60_000 },
  { label: 'Cross-Source-Signals', script: 'seed-cross-source-signals.mjs', seedMetaKey: 'intelligence:cross-source-signals', canonicalKey: 'intelligence:cross-source-signals:v1', intervalMs: 15 * MIN, timeoutMs: 120_000 },
  { label: 'Regional-Snapshots', script: 'seed-regional-snapshots.mjs', seedMetaKey: 'intelligence:regional-snapshots', intervalMs: 6 * HOUR,
    // 600s, not 180s. The section budget was BELOW the job's own measured runtime: this
    // same script completes in 205-287s when the sweep runs it standalone, so 180s could
    // never succeed and the section reported `timeout after 180s` every night while the
    // standalone copy quietly did the work. Budgets have to be set from measurement.
    // 900s, not 600s: the per-call budget rose to 95s from measurement (see
    // narrative.mjs), so 8 regions worst-case is 760s and 600s could SIGTERM a
    // legitimate run. Third time this class has bitten here — the budget follows
    // the measurement, not the other way round.
    timeoutMs: 900_000 },
]);
