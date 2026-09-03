// The call budget must never silently cap a provider timeout.
//
// This is the regression guard for a bug that ran unnoticed for at least a week
// (docs/ollama-40s-500s.md). `callLlmDefault` aborts each attempt with:
//
//     AbortSignal.timeout(Math.max(1, Math.min(provider.timeout, usable)))
//
// where `usable = NARRATIVE_LLM_CALL_BUDGET_MS - NARRATIVE_LLM_CALL_BUDGET_GUARD_MS`.
// The budget was 45s and the guard 5s, so `usable` was 40s — which silently
// overrode the local provider's declared 60s and aborted every call at exactly
// 40.000s. ollama logged 103 of those as HTTP 500 in one week; each one fell
// through to cloud providers that also failed, and the region shipped an EMPTY
// narrative while the bundle reported `OK … persisted=8 skipped=0 failed=0`.
//
// The declared timeout is the contract. If a budget is going to be lower, that
// has to be a visible decision, not arithmetic nobody can grep for: the value
// 40_000 appears nowhere in the tree, which is exactly why the cause stayed
// hidden through two repo-wide searches.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PROVIDERS,
  NARRATIVE_LLM_CALL_BUDGET_MS,
  NARRATIVE_LLM_CALL_BUDGET_GUARD_MS,
} from '../scripts/regional-snapshot/narrative.mjs';

const usableMs = () => NARRATIVE_LLM_CALL_BUDGET_MS - NARRATIVE_LLM_CALL_BUDGET_GUARD_MS;

describe('narrative LLM call budget', () => {
  it('leaves every provider its full declared timeout', () => {
    const usable = usableMs();
    assert.ok(DEFAULT_PROVIDERS.length > 0, 'provider chain must not be empty');
    for (const p of DEFAULT_PROVIDERS) {
      assert.ok(
        usable >= p.timeout,
        `budget silently caps "${p.name}": it declares ${p.timeout}ms but the call budget ` +
        `allows only ${usable}ms (${NARRATIVE_LLM_CALL_BUDGET_MS} - ` +
        `${NARRATIVE_LLM_CALL_BUDGET_GUARD_MS} guard). Effective deadline would be ` +
        `${Math.min(p.timeout, usable)}ms, a number that appears nowhere in the source.`,
      );
    }
  });

  it('bounds the worst case inside the Regional-Snapshots section budget', () => {
    // 8 regions, sequential. seed-bundle-derived-signals.mjs allows 900_000ms for
    // the Regional-Snapshots section, so the per-call budget has to fit 8 of them.
    // Asserted here rather than in a comment because the last two incidents of this
    // class were both budgets that a comment claimed were safe.
    const REGIONS = 8;
    const SECTION_BUDGET_MS = 900_000;
    const worstCase = REGIONS * NARRATIVE_LLM_CALL_BUDGET_MS;
    assert.ok(
      worstCase <= SECTION_BUDGET_MS,
      `worst case ${REGIONS} x ${NARRATIVE_LLM_CALL_BUDGET_MS}ms = ${worstCase}ms exceeds the ` +
      `section's ${SECTION_BUDGET_MS}ms, so the section can be SIGTERMed mid-run`,
    );
  });

  it('covers the measured per-region cost with headroom', () => {
    // Measured 2026-09-03 uncapped on granite/CPU: 18.0-65.0s per region. The budget that
    // failed allowed 40s usable, i.e. below the observed worst case — the same
    // "budget below the job's own measured runtime" that hit Regional-Snapshots
    // (180s vs 205-287s) and regional-briefs (900s vs 7x300s).
    const MEASURED_WORST_MS = 65_000;
    assert.ok(
      usableMs() >= MEASURED_WORST_MS,
      `usable budget ${usableMs()}ms is below the measured worst case ${MEASURED_WORST_MS}ms`,
    );
  });
});
