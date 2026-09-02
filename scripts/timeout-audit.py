#!/usr/bin/env python3
"""Find timeouts that cannot fit inside the budget of the job running them.

WHY: two nightly failures on 2026-09-02 were pure arithmetic, not broken code.
  - weekly briefs: 7 regions x a 300s per-region LLM timeout, inside a 900s ceiling.
  - derived-signals/Regional-Snapshots: a 180s section budget for a job measured at
    205-287s, with a 300s inner LLM call — ONE call allowed to outlast the whole section
    containing eight of them.
Both were "generous" round numbers rather than values derived from measurement, and both
failed every single night while looking like flaky infrastructure.

The unconditional bug this detects: an inner call whose timeout is >= the budget of the
section that runs it. No amount of luck makes that fit.
"""
import re, sys, pathlib, collections

HERE = pathlib.Path(__file__).parent
SEC = re.compile(r"label:\s*'([^']+)'[^}]*?script:\s*'([^']+)'[^}]*?timeoutMs:\s*([0-9_]+)", re.S)
SEC2 = re.compile(r"script:\s*'([^']+)'[^}]*?label:\s*'([^']+)'[^}]*?timeoutMs:\s*([0-9_]+)", re.S)
INNER = re.compile(r"timeout:\s*([0-9_]+)")
IMPORT = re.compile(r"from\s+'(\./[^']+\.mjs)'")

def num(s): return int(str(s).replace('_', ''))

def inner_timeouts(script, depth=0, seen=None):
    """Largest inner timeout in a script, following relative .mjs imports one level."""
    seen = seen or set()
    p = HERE / script
    if not p.is_file() or str(p) in seen or depth > 2:
        return []
    seen.add(str(p))
    txt = p.read_text(errors='replace')
    vals = [(num(m), script) for m in INNER.findall(txt) if num(m) >= 1000]
    for imp in IMPORT.findall(txt):
        vals += inner_timeouts(str((p.parent / imp).relative_to(HERE)), depth + 1, seen)
    return vals

rows, findings = [], []
for f in sorted(HERE.glob('seed-bundle-*.mjs')):
    bundle = f.stem.replace('seed-bundle-', '')
    txt = f.read_text(errors='replace')
    got = [(l, s, t) for l, s, t in SEC.findall(txt)] or \
          [(l, s, t) for s, l, t in SEC2.findall(txt)]
    for label, script, tms in got:
        budget = num(tms)
        inners = inner_timeouts(script)
        rows.append((bundle, label, script, budget, inners))
        worst = max(inners, default=(0, ''))
        if worst[0] >= budget:
            findings.append((bundle, label, script, budget, worst))

print("timeout audit — inner calls that cannot fit their section's budget")
print("=" * 92)
print(f"  sections examined: {len(rows)}   with a detectable inner timeout: "
      f"{sum(1 for r in rows if r[4])}")
print()
if findings:
    for b, l, s, budget, (w, wf) in sorted(findings, key=lambda x: -x[4][0]):
        print(f"  [{b}/{l}]")
        print(f"      section budget {budget/1000:.0f}s   inner timeout {w/1000:.0f}s in {wf}")
        print(f"      -> ONE call may outlast the whole section; this cannot succeed")
    print()
    print(f"  {len(findings)} section(s) structurally cannot fit. Fix by deriving the")
    print("  budget from measured runtime, and the inner timeout from budget / calls.")
else:
    print("  No section has an inner timeout at or above its own budget.")
print()
# AGGREGATE CHECK. A call can fit its budget individually and still be impossible in
# bulk: the weekly briefs ran 7 regions x 300s inside a 900s ceiling, so no SINGLE call
# exceeded the ceiling and the per-call check above would have passed it. Multiply.
# ASK NODE FOR THE REGION COUNT, do not regex it. A first version matched
# `id: '...'` in shared/geography.js and got 37 — it was picking up country entries
# alongside the 8 regions, and then reported the ALREADY-FIXED section as broken
# (37 x 60s vs a 600s budget). A checker that invents its own inputs produces
# confident nonsense; the module is right there, so import it.
import subprocess
try:
    out = subprocess.run(
        ['node', '--input-type=module', '-e',
         "import {REGIONS} from './scripts/shared/geography.js';console.log(REGIONS.length)"],
        cwd=HERE.parent, capture_output=True, text=True, timeout=30)
    n_regions = int(out.stdout.strip())
except Exception:
    n_regions = 0  # unknown -> skip the aggregate check rather than guess

LOOPS = re.compile(r"from\s+'.*shared/geography(?:\.js)?'")
agg = []
for b, l, script, budget, inners in (rows if n_regions else []):
    p_ = HERE / script
    if not p_.is_file():
        continue
    if not LOOPS.search(p_.read_text(errors='replace')):
        continue
    worst = max(inners, default=(0, ''))[0]
    if worst and worst * n_regions > budget:
        agg.append((b, l, budget, worst, worst * n_regions))
if n_regions and agg:
    print(f"  AGGREGATE — per-region work that cannot fit even though one call can")
    print(f"  ({n_regions} regions detected in shared/geography.js):")
    for b, l, budget, w, tot in sorted(agg, key=lambda x: -x[4]):
        print(f"    {b}/{l}: {n_regions} x {w/1000:.0f}s = {tot/1000:.0f}s vs a {budget/1000:.0f}s budget")
    print()
    findings.extend(agg)

# STANDALONE SEEDERS UNDER A SHELL CEILING. Bundle sections are not the only budget:
# the weekly briefs run from seed-briefs.sh under `timeout 1200`, and THAT is what the
# 7 x 300s originally overran. A section-only audit passes them blind — it did, on the
# first version of this file, which caught the snapshot bug and missed the briefs bug it
# was written for.
WRAP = re.compile(r"timeout\s+(\d+)\s+node\s+\"?scripts/\$?\{?(\w[\w-]*)")
wrapped = []
for sh in sorted(HERE.glob('*.sh')):
    txt = sh.read_text(errors='replace')
    for ceil, _ in WRAP.findall(txt):
        # the loop variable names the scripts; collect them from the for-list
        for m in re.finditer(r"for\s+\w+\s+in\s+([a-z0-9 _-]+);", txt):
            for name in m.group(1).split():
                wrapped.append((sh.name, int(ceil) * 1000, f"{name}.mjs"))

seen_w = set()
wfind = []
for shname, ceil_ms, script in wrapped:
    if (shname, script) in seen_w:
        continue
    seen_w.add((shname, script))
    p_ = HERE / script
    if not p_.is_file():
        continue
    txt = p_.read_text(errors='replace')
    inners = inner_timeouts(script)
    worst = max(inners, default=(0, ''))
    if not worst[0]:
        continue
    per_region = bool(LOOPS.search(txt)) if 'LOOPS' in dir() else False
    calls = n_regions if per_region and n_regions else 1
    total = worst[0] * calls
    if total > ceil_ms:
        wfind.append((shname, script, ceil_ms, worst, calls, total))
if wfind:
    print("  WRAPPER CEILING — standalone seeders whose work cannot fit their shell timeout:")
    for shname, script, ceil_ms, (w, wf), calls, total in sorted(wfind, key=lambda x: -x[5]):
        print(f"    {shname} runs {script} under timeout {ceil_ms/1000:.0f}s")
        print(f"      {calls} x {w/1000:.0f}s = {total/1000:.0f}s  (inner timeout in {wf})")
    print()
    findings.extend(wfind)

tight = [(b, l, budget, max(i, default=(0, ''))[0]) for b, l, s, budget, i in rows
         if i and budget / 2 <= max(i)[0] < budget]
if tight:
    print("  TIGHT (inner timeout is over half the section budget — 2 slow calls exhaust it):")
    for b, l, budget, w in sorted(tight, key=lambda x: -x[3]):
        print(f"    {b}/{l}: budget {budget/1000:.0f}s, inner {w/1000:.0f}s")
sys.exit(1 if findings else 0)
