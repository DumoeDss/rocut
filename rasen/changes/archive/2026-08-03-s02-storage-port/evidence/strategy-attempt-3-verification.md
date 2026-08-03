# Strategy Attempt 3 Independent Verification

Date: 2026-08-02  
Verifier role: independent non-author, report-only final material-gate verifier  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`  
HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
HEAD tree anchor: `286272307b05d23826ffa7223a76695365194dba`  
Attempt-3 product-worktree baseline: 86 status entries

Scope: strategy-attempt-3 required axes 1-6, the implemented optional trusted v2 upgrade, strict v3 codec/cardinality negatives, all attempt-2 and strategy-1 acceptance, the round1/round2 17-risk regression, complete real-Chromium C5 matrix, C4 forced-none stress, focused/isolated regressions, exact-three type ceiling, focused lint/format, all four positive/negative boundaries, diff/strict validation, and database/OPFS/port/runner hygiene.

This is the final strategy-3 material gate for B1. It is not section 11 final verification, does not authorize landing or archive, and does not replace fresh builds, parity, protected-hash, full inherited-suite, provenance, SBOM, license, or final write-set checks. Section 11 remains entirely unchecked.

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Summary scorecard

| Dimension | Scoped result |
| --- | --- |
| Completeness | Attempt-3 acceptance 7/7, including all six required axes, optional upgrade, and codec negatives; retained acceptance present |
| Correctness | Real-Chromium 7/7; complete cascade round2 24/24; all retained matrices green |
| Coherence | Candidate A followed: domain-complete v3 journal, dedicated authorization store, exact historical retry, atomic commit/CAS |

The full change task file remains 114/136 complete. Its 22 unchecked entries are the documented non-triggered 3.12 guard and the deliberately deferred section 11/final cleanup-and-ship tail. This scoped report does not relabel or edit them.

## Inputs and independent code inspection

The verifier ran the project-scoped Rasen status/instructions flow and read every proposal, design, delta-spec, and task artifact, followed by the attempt-3 design, implementation evidence, planner/implementer handoffs, and the current product delta. No implementation claim was accepted without code inspection and executable evidence.

The non-author audit confirmed:

- `browser-project-store-library-clear-bindings.ts:42` creates the dedicated `<projectsStore>-library-clear-bindings` store name, and its strict descriptor/target codecs require exact keys, fixed revisions/kinds, valid physical names, digest-derived row identity, canonical domain-tagged SHA-256, exact projects-control-plane binding, and target equality.
- `browser-project-store-cascade.ts:76` creates only revision-3 journals for new clear operations. The v3 decoder requires exact outer/envelope/targets/target keys and enforces projects=0 library targets and all=1 library target.
- `browser-project-store-cascade-manager.ts:208` prepares the exact media plan and library authorization before commit. All-clear routes through the three-store helper; projects clear contains no library authorization or target.
- `browser-storage-mechanisms.ts:288` performs project clear, maintenance replacement, exact descriptor conflict check, and descriptor put inside one read-write transaction over all three stores.
- `browser-storage-mechanisms.ts:348` performs the optional v2 same-ID journal promotion and descriptor put in one two-store transaction, comparing both the expected raw journal and any existing descriptor before either write.
- `browser-project-store-cascade-manager.ts:320` fails ambiguous v1/v2 library booleans closed. Only strict v2 plus explicit `previousLibraryBinding` can reach promotion; revision 1 is never promoted.
- `browser-project-store-cascade-manager.ts:541` completes media and library authorization reads before the cleanup loops begin. V3 library I/O uses journal target database/store, never the reopening wrapper's current library fields.
- The prior media descriptor/certificate model, binding-scoped owner mapping, projects-control-plane queue, cross-binding serialization, and same-ID pending-save barrier remain unchanged in meaning.

No code-review finding remained after the independent Chromium counterexamples and static gates below.

## Strategy-attempt-3 real-Chromium acceptance

| Axis | Independent result |
| --- | --- |
| 1. Interrupted old all-clear retries exact old library across changed media/library configuration | PASS: `version3AllJournalRetriesExactLibraryAcrossConfigurationReload=true` |
| 2. Projects clear across configuration reload never touches either library | PASS: `projectsJournalNeverTouchesLibraryAcrossConfigurationReload=true` |
| 3. Tampered descriptor fails closed before library or remaining media I/O | PASS: `tamperedLibraryBindingCannotCrossDelete=true` |
| 4. Legacy v2 `clearLibrary:true` without trusted history fails closed | PASS: `legacyVersion2LibraryBooleanFailsClosed=true` |
| 5. Optional trusted v2 binding upgrade atomically promotes and converges | PASS: `legacyVersion2LibraryBindingUpgradeConverges=true` |
| 6. Post-library/pre-journal crash retries the same exact target idempotently | PASS: `postLibraryPreJournalCrashRetriesExactTarget=true` |
| Strict codec/cardinality/additional-key negative family | PASS: `version3CodecCardinalityTamperRejects=true` |

Attempt-3 result: 7/7. The original B1 two-library counterexample no longer reproduces: the old exact library is cleared, the different reopening wrapper's library remains byte-for-byte unchanged, exact media cleanup converges, and the journal is removed.

The codec-negative family independently retained three malformed v3 rows and both old/new library sentinels while emitting nonretryable corrupt diagnostics: projects scope with a library target, all scope without its required target, and duplicate/wrong-cardinality state with an extra envelope key.

## Complete real-Chromium matrix

Command, from `apps/vite-example`:

```text
bunx playwright test --config playwright.c5-storage.config.ts
```

Environment: Playwright Chromium `151.0.7922.34`, CDP `1.3`, Windows headless Chrome.

Result: exit 0; 3 passed in 18.2 seconds.

- Browser ProjectStore shared matrix: 19 passed / 0 failed / 0 skipped.
- Migration round 1: all 16 named results true; before/after database inventories empty.
- Migration round 2: lifecycle 16/16 with 0 failures; attempt-2 M1 2/2 plus strategy-1 M1 6/6 true.
- Cascade round 1: 9/9 named results true.
- Cascade round 2: 24/24 named results true: 7 attempt-3 groups plus all 17 prior controls.
- Attempt-2 M2 6/6 and strategy-1 M2 5/5 remained true.
- Residual corrupt list/load: 6/6 true.
- Active mid-flight read abort: 7/7 true.
- C4 forced-none browser spec: passed.
- Migration round-1 adversarial browser spec: passed.

## Retained attempt-2, strategy-1, and 17-risk regression

- Attempt-2 M1 remained 2/2: valid pre-recovery removal intent migrates without resurrection; malformed tombstone rejects.
- Strategy-1 M1 remained 6/6: staged/original later save/remove precedence and both ambiguity-retention axes.
- Attempt-2 M2 remained 6/6: mismatch refusal, certified history cleanup, rev1 non-rebinding, binding-scoped exactness, cross-binding race serialization, and v2 journal reload.
- Strategy-1 M2 remained 5/5: certified enumeration-masked projects/all clear, uncertified atomic refusal for both scopes, and registration/clear serialization.
- All seven attempt-1 acceptance requirements therefore remained green.
- Round 1 retained 10/10 risk groups: provider-private migration; two-session libraries; cascade/migration recovery; old envelope; wrapper serialization; typed corruption; late-save cleanup; external-target refusal; active abort.
- Round 2 retained 7/7 risk groups: opaque/cross-project cascade refusal; 16 lifecycle races; same-instance initialization retry; cleanup-intent/readback reload recovery; namespace/all-clear atomicity; stale preset publication prevention.

## C4 stress and focused executable evidence

### C4 forced-none stress

```text
bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/c4-forced-none.pw.ts --repeat-each=5
```

Result: exit 0; 5/5 passed. Together with the complete matrix, C4 passed 6/6.

### Focused and isolated regressions

- Strategy-focused port/storage/negative-boundary command: 48 passed, 0 failed, 216 expectations across 3 files.
- Broad 16-file C5 regression command: 65 passed, 0 failed, 241 expectations.
- Deterministic async session/store suite: 14 passed, 0 failed, 78 expectations.
- Provider-private migration: 1 passed, 0 failed, 6 expectations.
- Deterministic project persistence suite: 4 passed, 0 failed, 19 expectations.
- Expanded deterministic aggregate: 19 passed, 0 failed, 103 expectations.

The expected Zustand storage-unavailable messages occurred only inside the sticker negative path; all assertions passed.

## Type, lint, format, and architecture gates

### Type gates

- Vite example direct TypeScript: exit 0; zero diagnostics.
- `node script/check-type-baseline.mjs`: exit 0 under TypeScript 5.9.3; exactly 3 diagnostics now versus 13 at pin `cf5e79e9`; no identity outside the pinned set.
- Direct non-incremental `apps/web` TypeScript reproduced exactly the expected identities:
  1. `next.config.ts(78,49)` — TS2345
  2. `src/timeline/__tests__/update-pipeline.test.ts(69,40)` — TS2769
  3. `src/timeline/placement/__tests__/resolve.test.ts(646,5)` — TS2769

### Focused lint and format

- Exact seven-file attempt-3 product ESLint set: exit 0; 0 file errors / 0 file warnings. Only the repository environmental Next pages-directory notice was printed.
- Prettier across the seven product files plus Vite harness/Playwright assertion: exit 0; all matched.

### Four positive boundaries

- Port boundary: exit 0; 30 contract modules; every rule passed.
- Storage boundary: exit 0; 722 source modules; 0 direct singleton imports/exports, 0 adapter references, 0 unexpected mechanism hits, 0 unclassified persistence-localStorage files, one ProjectStore role, and no production in-memory fallback.
- Host composition: exit 0; 2 Host roots / 719 production modules; every rule passed.
- Session-state boundary: exit 0; 10/10 factories, 10/10 registry keys, 52 classified imperative modules.

### Four negative/non-vacuity boundaries

- Port negative control: exit 0; 22/22 probes matched expectation.
- Storage negative fixtures: exit 0; 19 passed, 0 failed, 37 expectations.
- Host negative control: exit 0; 12/12 intended violations caught.
- Session-state negative control: exit 0; 36/36 probes matched expectation.

### Diff and strict validation

- `git -c core.whitespace=cr-at-eol diff --check`: exit 0; only expected LF-to-CRLF worktree notices.
- `rasen validate s02-storage-port --project rocut --strict --json`: exit 0; 1/1 valid, zero issues.

## Cleanup and immutability audit

- Full Chromium reported `beforeDatabases=[]` and `afterDatabases=[]` and nonempty exact cleanup proofs for migration, migration-round2, cascade, and cascade-round2 identities.
- The browser fixtures' `finally` paths cleaned each exact disposable IndexedDB/OPFS identity; no user-profile identity was opened.
- The delayed Playwright Vite listener was inspected before cleanup. PID 18792 was the exact worktree `node .../vite.js --port 4175` child of exact worktree `vite.exe` PID 46828; only that verified chain was stopped.
- Playwright's exact `.last-run.json` and then-empty `.pw-output-c5-storage` directory were removed.
- Final listeners: ports 4175, 43551, and 43552 each had 0 listeners.
- Product worktree status returned to the inherited attempt-3 baseline of exactly 86 entries; verifier execution introduced no product delta.
- HEAD and HEAD tree remained unchanged at the identities above.
- `tasks.md` SHA-256 remained `48173DD339B195768F05FC9A6EEBF64D172E7D3120818E6743DE8F7467212674`.
- Section 11 remains 12/12 unchecked. No task checkbox was changed.

## Findings by priority

### Blocker

None. B1 is closed by independent non-author code inspection and reproduction of the original cross-library counterexample.

### Major

None.

### Minor

None.

### Trivial

None.

## Scoped assessment

Strategy attempt 3 is independently clean at the final material gate. The revision-3 domain-complete journal closes B1 without weakening attempt-2 media authorization, strategy-1 migration/clear guarantees, or the 17 retained risk groups. The strategy budget is exhausted successfully. This report intentionally stops before section 11 and does not claim archive readiness.

TEST EVIDENCE
- scope: attempt-3 six required axes, optional trusted v2 upgrade, strict codec negatives, complete Chromium C5 matrix, attempt-2/strategy-1/17-risk regression, C4 stress, focused/isolated suites, exact-three and Vite type checks, ESLint, Prettier, four positive/negative boundaries, diff, strict, database, OPFS, ports, runner, tasks, and worktree hygiene
- rationale: independently reproduces B1's old/new library counterexample and every fail-closed/atomicity/retry boundary while proving all earlier C5 material controls remain intact
- command: exact commands, selectors, environment, exit codes, and counts are recorded above
- result: pass
- tree: `286272307b05d23826ffa7223a76695365194dba` (HEAD tree anchor; verified implementation is the uncommitted 86-entry product worktree above it)

