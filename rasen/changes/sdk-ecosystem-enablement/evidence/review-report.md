# Pre-landing second delta re-review: sdk-ecosystem-enablement

Date: 2026-08-16

Reviewer mode: dispatched, report-only, same author-not-verifier reviewer. Base:
`origin/main` at `661d7ac87c3d324839d51bf30470bbf81764b694`. Branch/HEAD:
`feat/sdk-ecosystem-enablement` at the same commit; the reviewed delta remains entirely in the
working tree.

## Verdict

**CLEAN — all six original findings are closed and the second remediation delta introduces no
new finding.**

Pre-Landing Re-review: **No issues found.** The previously open scratch-quarantine identity
finding and guide-command execution-binding finding are both closed. The four findings closed by
the first re-review remain closed.

Scope Check: **CLEAN**. The second remediation is confined to the two retained findings, their
fault/negative controls, and truthful regression/hygiene evidence.

## Original finding closure matrix

| # | Original severity | Final status | Evidence |
| ---: | --- | --- | --- |
| 1 | Blocker | **CLOSED** | `.github/workflows/bun-ci.yml:161-165` installs the locked root workspace before the drift checker; `script/check-adapter-project-template.mjs:170-184` enforces that ordering. |
| 2 | Blocker | **CLOSED** | `script/scratch-lifecycle-safety.mjs:184-202` binds the live quarantine directory identity to the pre-rename tree before accepting its marker; the copied-marker swap and partial-cleanup controls are at `script/__tests__/scratch-lifecycle-safety.test.mjs:187-224,252-289`. |
| 3 | Major | **CLOSED** | `script/run-adapter-author-template.mjs:32-50,77-86` makes executable and argv part of the descriptor consumed by the sole executor; `script/check-adapter-author-guide-commands.mjs:76-90,186-208` enforces that structure and fires an execution-only negative control. |
| 4 | Major | **CLOSED** | `packages/editor-contracts/src/conformance/fakes/index.ts:193-200` validates the resolved store inside the setup step, with malformed-shape coverage in `fakes.test.ts`. |
| 5 | Minor | **CLOSED** | `BOUNDARIES.md:1230-1235` describes exact pins as version intent rewritten to fresh `file:` materialization and makes no registry-coordinate claim. |
| 6 | Minor | **CLOSED** | `final-hygiene.md` records the current 56-file inventory and the second re-review independently reproduced its strict text and structure results. |

## Second-delta verification

### A. Scratch quarantine identity and cleanup reporting — CLOSED

After the authenticated canonical root is renamed, `captureMovedOwnedTree` now inspects the
directory currently at the quarantine path and requires its device/inode identity to equal the
pre-rename capture before marker validation or construction of `movedCapture`
(`script/scratch-lifecycle-safety.mjs:184-202`). A plain replacement directory carrying a copied
valid marker therefore fails closed rather than being blessed for recursive deletion.

The `afterRenameBeforeCapture` hook sits in the exact rename-to-first-capture window
(`scratch-lifecycle-safety.mjs:313-324`). Its fault test parks the authenticated tree, installs a
plain copied-marker replacement, expects the identity rejection, and proves the replacement
sentinel and marker remain (`scratch-lifecycle-safety.test.mjs:187-224`).

Cleanup exceptions and cleanup calls that return without removing the quarantine both invoke
`describeCleanupFailureState`, which rechecks canonical presence and revalidates the quarantine
directory plus marker before describing residue (`scratch-lifecycle-safety.mjs:205-225,346-372`).
The injected partial-cleanup test removes one child, throws, and verifies the reported
authenticated residue and exact remaining files (`scratch-lifecycle-safety.test.mjs:252-289`).
The checked-in focused result is 7 passing lifecycle cases / 29 expectations; this dispatched
review did not rerun it.

### B. Guide descriptor to actual execution binding — CLOSED

Each author command descriptor owns its stable id, executable, and argv, and renders its guide
body from those fields (`script/run-adapter-author-template.mjs:32-50`). `runAuthorCommand` is the
single author-command executor and passes `descriptor.id`, the platform-resolved
`descriptor.executable`, and `descriptor.args` directly to the sole `runLogged` call site
(`run-adapter-author-template.mjs:77-86`). The four in-project author commands call that executor
by descriptor id (`run-adapter-author-template.mjs:225-287`).

The checker statically requires exactly one `runLogged` call site and the descriptor-bound
id/executable/argv expression (`script/check-adapter-author-guide-commands.mjs:76-90`). Its fourth
negative direction mutates the actual executor argv to a literal imaginary command while leaving
the guide, descriptor, and id unchanged; the structural gate must then report that execution is
not descriptor-bound (`check-adapter-author-guide-commands.mjs:186-208`). The checked-in live and
four-direction negative gates are green; this dispatched review did not rerun them.

## Fix-delta safety and evidence-honesty review

The scratch lifecycle now covers the destructive boundaries relevant to this change: captured
parent/root identity before forward rename, live post-rename identity before quarantine capture,
parent/tree/marker revalidation immediately before recursive cleanup, redirect rejection, and
post-failure residue reinspection. The new fault controls preserve unrelated sentinels and do not
widen cleanup beyond the authenticated quarantine path.

`final-regression.md:200-210` accurately separates four commands rerun against a retained
successful materialization from a later fresh materialization whose four packs succeeded but npm
installation failed with `ENOSPC` at roughly 1.63 GB free. It explicitly says that attempt is not
green. No clean install result is inferred from it; the earlier successful fresh/same-root and
shared-harness runs remain the recorded integration evidence.

## Coverage diagram

```text
CODE PATH COVERAGE
==================
[+] scratch lifecycle
    |-- [★★★ CHECKED-IN TEST] exact owned rerun; foreign/copied marker
    |-- [★★★ CHECKED-IN TEST] parent/root redirect before forward rename
    |-- [★★★ CHECKED-IN TEST] post-rename copied-marker plain-directory swap
    |-- [★★★ CHECKED-IN TEST] redirected quarantine before cleanup
    `-- [★★★ CHECKED-IN TEST] partial cleanup failure + re-inspected residue

[+] guide/runner drift
    |-- [★★★ CHECKED-IN CONTROL] guide body <-> executable/argv descriptor
    |-- [★★★ STATIC BINDING] one descriptor-bound runLogged executor
    `-- [★★★ CHECKED-IN CONTROL] execution-only argv mutation fires

USER FLOW COVERAGE
==================
[+] fresh root and same exact root rerun       [★★★ recorded evidence]
[+] P3 and published-example harness consumers [★★★ recorded evidence]
[+] adversarial quarantine swap                [★★★ checked-in fault test]
[+] actual-command-only drift                  [★★★ checked-in negative control]
```

Step 4.75: all remediation code paths implicated by the two retained findings have checked-in
coverage.

## Axes

### Standards axis

No unresolved documented-standard, atomic-tree-safety, or Fowler-baseline finding in the second
remediation delta.

Count: **0 Standards findings.**

### Spec axis

The remediation now satisfies design E4 and tasks 4.1/4.3: scratch cleanup fails closed on the
reviewed redirect/swap boundaries, and executable guide commands are mechanically tied to the
runner execution source. No missing requirement, wrong implementation, or scope creep was found.

Count: **0 Spec findings.**

## Reviewed inventory and commands

The complete current inventory is 56 files: 18 tracked modifications and 38 untracked paths from
`git ls-files -m -o --exclude-standard`. The second re-review read the complete current lifecycle
implementation and test, shared harness integration, author runner, guide checker, change spec,
and final regression/hygiene evidence, while retaining the prior full-delta review context.

- `git fetch origin main --quiet`: exit 0; base remains
  `661d7ac87c3d324839d51bf30470bbf81764b694`.
- `gh pr view --json number,url`: exit 1; no PR exists for the current branch, so Greptile triage
  is inapplicable.
- `git diff --check origin/main`: exit 0.
- Strict UTF-8 scan over all 56 files: 0 invalid files, BOMs, CR-bearing files, replacement
  characters, or selected mojibake patterns.
- Structured files: 9/9 JSON parsed; workflow and `.openspec.yaml` parsed with PyYAML.
- `node --check` passed for the lifecycle implementation/test, shared harness, author runner, and
  guide checker.
- Per dispatched-review rules, this reviewer did not rerun tests or executable gates. Test counts,
  negative-control results, integration populations, and the `ENOSPC` run are attributed to the
  checked-in `final-regression.md` evidence.
- No implementation, test, commit, push, PR, or external-message action was performed. This
  canonical report is the only repository write by the reviewer.

STATUS: DONE
