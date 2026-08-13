# Implementation report: s0304-ui-commit-routing

## Disposition

- Schema: `spec-driven`
- Branch: `feat/s0304-ui-commit-routing`
- T3 base: `f2e36b9b9ced88f3bee9514d5fa5f37febdd8abd`
- Preserved T3 implementation: `552f15a1d1e447f174121197f725dc5d42be27ba`
- Reviewed `update-project` prerequisite: `aac84ff1730398879181cc689f1018ac8c92e9a1`
- Integration merge: `27e4e8d2befa4b42a178ac55ec166d381a52e19c`
- Result: implementation complete; 46/46 tasks verified

The UI command path now prepares one detached OpenCut candidate, derives one stable typed operation batch, commits it through the session's canonical transaction engine, and publishes live state/history/selection only after the single durable save succeeds. Undo, redo, pointer finalization, ripple/reactor work, settings, automation, and persistence coordination use the same ordered authority. Provider-private and immediate effects remain explicitly classified outside false transaction claims.

## Material behavior delivered

- OpenCut projection, stable diff, donor adapter, versioned transaction envelope, candidate token/base/projection checks, encoded publication receipts, and per-project mutation arbitration.
- One shared session engine facade for UI and automation, with exact-record cache adoption and suppression of duplicate legacy publication saves.
- Detached atomic command preparation for batches, nested work, ripple, and reactors; fail-closed exhaustive routing registration.
- Typed `update-project` routing for public/mixed Project settings, provider-private handling for private-only settings, and explicit historyless typed transactions.
- First-image canvas behavior is preserved end to end: 1920x1080 becomes 320x180 in the live donor, engine read, persisted record, coordinator cache, and reopen. Undo removes inserted content while retaining canvas/original-canvas settings that were deliberately outside inverse ownership.
- Routed undo/redo store and submit typed inverse/forward material and move stacks only after durability.
- Pointer preview remains local; the final accepted interaction commits once and a failed final commit retains the overlay.
- Import frame-rate ratchets run only after attachment success through the shared engine, and final-document placement rejects an old-only time grid.
- Production-safe routing uses explicit stable classifications rather than minifiable constructor names; audio projection normalizes non-boolean `hidden` to `false`.

## Verification summary

| Gate | Result |
| --- | --- |
| Combined T3 plus reusable T0/T1/T2 suites | 76 pass, 0 fail, 793 assertions |
| T3-authored TS/TSX ESLint set | 67 files pass |
| Type baseline | pass; 3 diagnostics, ceiling 3 |
| Transaction boundary | pass; 31 modules |
| Transaction boundary negative control | pass |
| Strict Rasen validation | pass; 1/1 item, zero issues |
| Vite production build after routing | pass; 2,918 modules; established chunk/import warnings only |
| Next production build after routing | pass; 19/19 pages; established workspace-root warning only |
| Vite production build at pre-routing baseline | pass; 2,893 modules; established chunk/import warnings only |
| Next production build at pre-routing baseline | pass; 19/19 pages; established workspace-root and placeholder-secret warnings only |
| After-routing Vite parity scenario | pass, 1/1 |
| After-routing Next parity scenario | pass, 1/1 |
| Baseline Vite parity scenario | pass, 1/1 in 42.2 seconds |
| Baseline Next parity scenario | pass, 1/1 in 40.7 seconds with the documented placeholder runtime environment |
| `git diff --check` | pass |

The first baseline Next attempt intentionally remains classified as an environment reproduction, not a product failure: starting `next start` without the documented placeholder environment made `/editor/<id>` return HTTP 500 while `/projects` remained available. Supplying the same placeholder environment used by the documented build path made the editor route return 200 and the unchanged scenario pass. No fixture, oracle, snapshot, or product source was changed to obtain that result.

### Pointer trace

The focused pointer case emits 12 preview frames. During those frames: 0 project saves, revision delta 0, 0 transaction watcher calls, and history delta 0. Accepted finalization produces exactly 1 save, revision delta 1, 1 watcher call, and 1 history entry. Cancel produces zero additional commits. Injected save failure retains the overlay and leaves revision/history unchanged.

## Four-axis parity evidence

| Axis | Raw oracle/result | Editing conclusion |
| --- | --- | --- |
| Baseline Vite vs baseline Next | 9 differences: 0 semantic, 9 established Host incidental | pass |
| After Vite vs after Next | 28 differences: 19 fail-safe `semantic`, 9 established Host incidental | all 19 new rows are transaction-envelope metadata; editing fields retain the established Host relationship |
| Baseline Vite vs after Vite | 100 raw leaf differences: 80 added transaction-envelope leaves and 20 shifted normalized ID ordinals | canonical editing views are byte-identical |
| Baseline Next vs after Next | 100 raw leaf differences: 80 added transaction-envelope leaves and 20 shifted normalized ID ordinals | canonical editing views are byte-identical |

The same-host editing view comparison removes only `project.__opencutTransaction`, removes the normalizer's bookkeeping ledger, and then reassigns `<id:n>` placeholders by first appearance. It does not change track membership, clip order, placement, trim, duration, Project settings, media metadata, or any source fixture/snapshot. Stable hashes are:

- baseline Vite editing view = after Vite editing view: `98bbb7fa49c62dfc8081f1c0d199f555cac96144fa3287198e17bae25f89ca98`
- baseline Next editing view = after Next editing view: `e1f6b993523ae0c6a3154ecf8924c5bc19944b343a5e6cbd41eba271371336ae`

Raw snapshot hashes:

- baseline Vite: `a49213df4f9d4f55b36f0a34dddd24238cc7e6bb588f5f7742a1909b157fd9bd`
- baseline Next: `0e3813b4fccc2eb3a8b5a3b04b2d8adafb17a3e5408e03cd17d9011147fd3ed6`
- after Vite: `e1f2b5e3aa002d7459c811b3217f7489e96617f707735a409576717c5c782845`
- after Next: `90b7a90978afdc26d6d67cc49dae5e8837981a661e88d244884295b03e02585a`

Raw snapshot equality is not claimed. The after-routing snapshot must contain durable revision/idempotency metadata required by the canonical transaction specification. Independent runs also necessarily generate distinct UI idempotency keys and entity UUIDs; fingerprints contain those UUIDs, and their first-appearance order shifts normalized created-ID ordinals. The untouched fail-safe oracle therefore reports 19 metadata rows as semantic. This finding is accepted as satisfying the editing-semantic requirement because both same-host editing views are exact matches and the new raw state is required protocol evidence. Changing the oracle/fixture or weakening persisted identity/idempotency to manufacture raw equality was explicitly rejected.

## Canonical capability sweep

The companion [spec-falsification-sweep.md](./spec-falsification-sweep.md) enumerates every Requirement block in every canonical `rasen/specs/*/spec.md` present at verification time:

- 16 spec files
- 141 Requirement blocks
- 314 uppercase `SHALL` occurrences
- 39 uppercase `MUST` occurrences
- 353 total normative occurrences
- 0 assertions falsified by T3
- corpus SHA-256: `659f7cc1d3ea79df2e8108e39fe206ead2ea600ae8d5ef15ecbb24c06ade7969`

For the updated canonical `transaction-automation-api`, all 25 Requirement blocks were reviewed. T0 contract/read/apply/revision/idempotency/error/context/watch/fake/conformance requirements are exercised unchanged; T1 durable ordering, failure atomicity, validate/dry-run, placement, typed feature, reopen, and conformance requirements run against the OpenCut adapter/facade; T2 Draft requirements remain covered by the reusable conformance in the combined suite; and the twelfth typed `update-project` requirement is covered by first-image, settings routing, historyless FPS, final-document placement, engine read, exact persistence, and reopen tests.

The change-specific delta additionally covers shared UI/automation ordering, durable-before-publication, composite atomicity, donor projection/opaque preservation, explicit routing classes, settings history ownership, pointer behavior, routed undo/redo, and duplicate/stale legacy-save prevention.

## Scope audit

The union of the preserved T3 commit (`f2e36b9..552f15a`) and the final working delta contains 75 task-owned paths. It contains no T3-authored match under:

- `apps/web/src/editor/contracts/**` or its engine/conformance implementation;
- a `ProjectStore` contract/implementation widening;
- either Host composition root or Vite application source;
- the React Surface boundary;
- `rust/**` or generated WASM;
- package extraction/manifest changes;
- the parity scenario, normalizer, diff oracle, fixture media, or snapshots;
- the type-baseline fixture.

The only T0/T1 widening in the integrated history is the separately reviewed `update-project` prerequisite at `aac84ff1`, consumed through merge `27e4e8d2`. T3 adds only the concrete donor adapter/routing layer outside `contracts/**` and its UI/persistence consumers.

## Remaining observations

- Git on this Windows checkout warns that LF files may become CRLF on a future Git conversion. The final raw-byte audit confirms the authored text remains strict UTF-8 without BOM and LF-only in this commit.
- Production build warnings are pre-existing advisory output: Vite's large chunk/dynamic+static import notices and Next's multi-lockfile workspace-root inference.
- No unrelated untracked Rasen artifacts, orchestration run-state, parity fixture/oracle, or baseline fixture were staged or edited.
