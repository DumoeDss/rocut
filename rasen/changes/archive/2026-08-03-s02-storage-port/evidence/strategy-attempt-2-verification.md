# Strategy Attempt 2 Independent Verification

Date: 2026-08-02  
Verifier role: non-author, report-only material-gate verifier  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`  
HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
HEAD tree anchor: `286272307b05d23826ffa7223a76695365194dba`  
Merged product-worktree baseline: 85 status entries

Scope: strategy-attempt-2 M1/M2 acceptance, strategy-attempt-1 acceptance 1-7, all 17 round1/round2 retained risks, the complete real-Chromium C5 matrix, C4 forced-none stress, focused and isolated regressions, all four positive/negative boundaries, the exact-three type ceiling, focused ESLint and Prettier, diff/strict validation, and database/OPFS/port/runner hygiene.

This is a scoped material gate. It is not section 11 final verification, does not authorize landing, and does not replace the deferred fresh builds, parity, full inherited regression, protected-hash, provenance, SBOM, license, or final write-set checks. Section 11 remains entirely unchecked.

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Inputs and independent code inspection

The verifier read `strategy-attempt-2-design.md`, both implementation reports, the retained attempt-1 verification, and the relevant product delta before running controls independently. The implementation claims were not accepted from reports alone.

The non-author code inspection confirmed:

- attachment migration classifies the complete stored record, skips a valid revision-2 removal tombstone before body access, and rejects a malformed tombstone rather than interpreting it as legacy attachment metadata;
- revision-1 media ownership remains physically unbound unless the trusted `previousMediaBinding` input is supplied; the explicit conversion writes the descriptor, scoped owners, certificate, and legacy-binding marker atomically;
- revision-2 descriptors recompute their binding fingerprint during strict decode; owners and coverage certificates are binding-scoped;
- clear planning maps each `(binding fingerprint, project ID)` owner to that binding only and does not form a global project-ID by binding cross-product;
- wrappers sharing `{projectsDatabase, projectsStore}` select the same mutation queue even when media bindings differ, serializing registration/certification against project/all clear;
- revision-2 journals strictly decode target entries and validate every target against retained certified binding history before exact deletion; a journal does not certify its own binding;
- pending revision-2 cleanup remains independent of the wrapper's current media prefix and blocks same-ID reuse by its explicit target project ID.

No code-review finding remained after the executable counterexamples below.

## Strategy-attempt-2 material acceptance

### M1: two new axes plus the retained six

| Axis | Independent Chromium result |
| --- | --- |
| Valid pre-recovery removal intent migrates without body read/resurrection | PASS: `preRecoveryIntentLaterRemoveMigrates=true` |
| Malformed pre-recovery tombstone refuses rather than falling through as legacy metadata | PASS: `malformedPreRecoveryTombstoneRejects=true` |
| Staged-project later save wins | PASS |
| Staged-project later remove wins | PASS |
| Original-project later save wins | PASS |
| Original-project later remove wins | PASS |
| Physical absence remains ambiguous and retains recovery | PASS |
| Digest mismatch remains ambiguous and retains recovery | PASS |

M1 result: attempt-2 2/2; retained strategy-1 6/6; combined 8/8.

### M2: six new groups plus the retained five

| Group | Independent Chromium result |
| --- | --- |
| Uncertified binding mismatch refuses atomically | PASS: `uncertifiedBindingMismatchRefusesAtomically=true` |
| Certified binding history cleans exact historical/current namespaces | PASS: `certifiedBindingHistoryCleansExactNamespaces=true` |
| Revision-1 ownership never implicitly rebinds | PASS: `revision1NeverImplicitlyRebinds=true` |
| Binding-scoped owners avoid cross-product deletion | PASS: `bindingScopedOwnersAvoidCrossProduct=true` |
| Cross-binding registration/clear race is serialized | PASS: `crossBindingRegistrationClearRaceIsSerialized=true` |
| Revision-2 journal retries across binding reload | PASS: `version2JournalRetriesAcrossBindingReload=true` |

The five retained strategy-1 axes also remained true: certified projects clear without enumeration, certified all clear without enumeration, uncertified projects clear atomic refusal, uncertified all clear atomic refusal, and owner-registration/clear serialization.

M2 result: attempt-2 6/6; retained strategy-1 5/5; combined 11/11.

## Complete real-Chromium matrix

Command, from `apps/vite-example`:

```text
bunx playwright test --config playwright.c5-storage.config.ts
```

Environment: Playwright Chromium `151.0.7922.34`, CDP `1.3`, Windows headless Chrome.

Result: exit 0; 3 passed in 31.0 seconds.

- Browser ProjectStore shared matrix: store 19 passed / 0 failed / 0 skipped.
- Migration round 1: 16/16 named results true; disposable external target refusal and no-undefined-name controls remained true.
- Migration round 2/lifecycle: 16 lifecycle races / 0 failures; all attempt-1 and attempt-2 M1 fields true.
- Cascade round 1: 9/9 named results true.
- Cascade round 2: 17/17 named results true, including all six new M2 groups and the retained forged-maintenance/atomicity/reload controls.
- Residual corruption paths: 6/6 true.
- Mid-flight read abort paths: 7/7 true.
- C4 forced-none browser control: passed.
- Migration round-1 adversarial browser spec: passed.

The Playwright web-server teardown printed a late `dev` exit line after the successful test summary; the Playwright command itself exited 0, and the final listener audit found no surviving server.

## Attempt-1 and round1/round2 regression

All seven attempt-1 acceptance requirements remained green through the retained M1 6/6 and M2 5/5 fields, including later-save/remove migration precedence, ambiguity refusal, certified enumeration-masked clear, uncertified atomic refusal, and registration/clear serialization.

All 17 earlier round1/round2 risks remained covered and green:

- Round 1, 10/10: provider-private migration; two-session library union/failure recovery; cascade recovery/reset; migration cleanup retry/diagnostics; old-envelope migration; ordinary wrapper serialization; typed corrupt list/load; duplicate late-save cleanup; external-target refusal; and seven active-abort paths.
- Round 2, 7/7: opaque cascade/cross-project refusal; 16 lifecycle races; same-instance initialization retry; cleanup-intent reload recovery; committed readback/later mutation precedence; namespace/all-clear atomic recovery; and stale preset load versus later save/remove.

## C4 stress and focused executable evidence

### C4 forced-none stress

```text
bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/c4-forced-none.pw.ts --repeat-each=5
```

Result: exit 0; 5/5 passed. Together with the complete matrix, the control passed 6/6 times.

### Focused regressions

- Strategy-focused port/storage/negative-boundary command: 48 passed, 0 failed, 216 expectations across 3 files.
- Broad 16-file C5 regression command: 65 passed, 0 failed, 241 expectations.
- Deterministic async session/store suite with `OPENCUT_SESSION_ASYNC_STORE_TEST_ISOLATED=1`: 14 passed, 0 failed, 78 expectations.
- Provider-private migration: 1 passed, 0 failed, 6 expectations.
- Deterministic project persistence suite with `OPENCUT_PROJECT_PERSISTENCE_TEST_ISOLATED=1`: 4 passed, 0 failed, 19 expectations.
- Expanded deterministic aggregate: 19 passed, 0 failed, 103 expectations.

One deliberately over-parallel verifier orchestration caused Bun 1.2.2 itself to segfault in a nested isolated child. The exact async-store control then passed serially at 14/0/78, and the broad regression independently passed the same wrapper. No product assertion failed; this was test-runner concurrency noise and was not used as passing evidence.

## Type, lint, format, and architecture gates

### Exact-three type ceiling

`node script/check-type-baseline.mjs` exited 0 under TypeScript 5.9.3: exactly 3 diagnostics now versus 13 at pin `cf5e79e9`, with no identity outside the pinned set.

A direct non-incremental `apps/web` `tsc` run independently reproduced exactly the three expected identities:

1. `next.config.ts(78,49)` — TS2345
2. `src/timeline/__tests__/update-pipeline.test.ts(69,40)` — TS2769
3. `src/timeline/placement/__tests__/resolve.test.ts(646,5)` — TS2769

### Focused ESLint and Prettier

- Exact 10-file product ESLint set: exit 0; 0 file errors / 0 file warnings. The only output was the repository's environmental Next pages-directory notice.
- Prettier check across the 10 product files plus the Chromium harness/assertion: exit 0; all matched files use Prettier style.

### Four positive boundaries

- Port boundary: exit 0; 30 contract modules; every rule passed.
- Storage boundary: exit 0; 721 source modules; zero direct `storageService` imports/exports, zero `BrowserHostAdapter` references, zero unexpected browser-mechanism hits, zero unclassified persistence-localStorage files, one ProjectStore role, and no production in-memory fallback.
- Host composition: exit 0; 2 Host roots / 718 production modules; every rule passed.
- Session-state boundary: exit 0; 10/10 factories, 10/10 registry keys, 52 classified imperative modules.

### Four negative/non-vacuity boundaries

- Port negative control: exit 0; 22/22 named catch/non-catch probes matched expectation.
- Storage negative fixtures: exit 0; 19 passed, 0 failed, 37 expectations.
- Host negative control: exit 0; 12/12 probes caught their intended violation.
- Session-state negative control: exit 0; 36/36 probes matched expectation.

### Diff and strict validation

- `git -c core.whitespace=cr-at-eol diff --check`: exit 0; only expected LF-to-CRLF worktree notices.
- `rasen validate s02-storage-port --project rocut --strict --json`: exit 0; 1/1 valid, zero issues.

## Cleanup and immutability audit

- Chromium migration reported `beforeDatabases=[]` and `afterDatabases=[]`.
- Migration, migration-round2, cascade, and cascade-round2 all returned non-empty exact disposable cleanup proofs; their fixtures clean both IndexedDB and OPFS identities in `finally` paths.
- Playwright used disposable browser contexts. Its exact empty generated directory `apps/vite-example/tests/.pw-output-c5-storage` was removed after inspection; no runner file remains.
- Final listeners: ports 4175, 43551, and 43552 each had 0 listeners.
- Product worktree status remained exactly the 85-entry inherited baseline; verifier execution introduced no product delta.
- HEAD and HEAD tree remained unchanged at the identities above.
- `tasks.md` SHA-256 remained `48173DD339B195768F05FC9A6EEBF64D172E7D3120818E6743DE8F7467212674`.
- Section 11 still contains 12/12 unchecked tasks. No task checkbox was changed.

## Scoped assessment

Strategy attempt 2 is independently clean at its material gate. Both M1 counterexamples and all six M2 binding-history/race/reload groups passed in real Chromium, the attempt-1 acceptance and all 17 earlier risks remained green, and no static or cleanup regression was found. This report intentionally stops before section 11.

TEST EVIDENCE
- scope: strategy-attempt-2 M1 2 plus retained 6; M2 6 plus retained 5; attempt-1 acceptance 1-7; round1/round2 17-risk regression; complete Chromium matrix; C4 stress; focused/isolated suites; four positive/negative boundaries; exact-three type ceiling; ESLint, Prettier, diff, strict, database, OPFS, ports, runner, tasks, and worktree hygiene
- rationale: independently exercises the two new migration cases and the exact-binding ownership/refusal/history/race/reload contract while proving the earlier C5 controls were not weakened
- command: exact selectors, environment, exit codes, and counts are recorded above
- result: pass
- tree: `286272307b05d23826ffa7223a76695365194dba` (HEAD tree anchor; verified implementation is the uncommitted 85-entry product worktree above it)

