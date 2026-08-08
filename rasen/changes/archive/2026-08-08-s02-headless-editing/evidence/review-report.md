# C7 Sol non-author review — round 1

Date: 2026-08-05 (Asia/Shanghai)

Reviewer role: fresh non-author Sol-xhigh, dispatched report-only. Product code, tests, tooling, commits, integration, delivery, and archive were not edited.

Reviewed identity:

- Worktree/branch: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c7 / feat/s02-headless-editing
- Accepted base HEAD/tree: a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf / 885d307814260b77397c2c2677b9361fdfc5f5e2
- Authored write set: 25 files, implementer manifest digest a6d795f56d68627415200324b0b8c16284aabc6f6de063139c1bc04eb81b806a
- Delivery state: uncommitted; no child commit/tree exists

VERIFY VERDICT: BLOCKED — Blocker:2 Major:3 Minor:0 Trivial:0

Pre-Landing Review: 5 issues (5 critical, 0 informational)

## Findings

### [Blocker] R1 — Next producer can certify an exact root that is not in any emitted chunk

Evidence:

- apps/web/build/headless-webpack-graph-plugin.ts:207-213 proves only that the named Webpack entrypoint has files.
- apps/web/build/headless-webpack-graph-plugin.ts:224-228 special-cases current === root into the reached set even when the root/owner has no chunk.
- apps/web/build/headless-webpack-graph-plugin.ts:250-252 assigns the entrypoint file list to the root instead of the root's actual chunk membership.
- apps/web/build/headless-webpack-graph-plugin.ts:267-272 then publishes emitted: true unconditionally.

The independent counterexample supplied a compilation whose exact route module existed once but whose chunkGraph returned an empty set. The producer returned:

    rootActualChunks: []
    producerEntry.emitted: true
    producerRootRecord.chunks: ["server/app/c7-headless/route.js"]
    accepted: true

Impact: the central Next exact-root/emitted-membership claim can be a false positive. An entrypoint wrapper being emitted does not prove that the required application root is retained in that output.

Disposition: accepted, open, route to the non-author Sol fixer. Require actual root/concatenated-owner chunk membership, never borrowed entrypoint membership, and add this zero-root-chunk counterexample as a failing regression.

### [Blocker] R2 — Vite checker accepts a truncated executable artifact with headless.html missing

Evidence:

- apps/vite-example/build/headless-module-graph.ts:115-120 inventories the generateBundle bundle.
- The accepted clean envelope lists only assets/headless-C8pPPm4-.js and its source map, while the browser executes headless.html.
- script/check-headless-graph.mjs:335-365 validates only the files named by the producer.

The independent counterexample copied the two recorded files into a new output root and deliberately omitted headless.html. checkHeadlessGraphEnvelope still returned ok: true.

Impact: deleting, truncating, or replacing the executable HTML facade does not invalidate the graph envelope. The Vite graph is therefore not tied to the complete artifact that was actually executed, contrary to the anti-vacuity and artifact-mutation scenarios.

Disposition: accepted, open, route to the non-author Sol fixer. Inventory/validate the final executable facade and its script relationship after Vite has emitted it, then add missing/altered-HTML controls.

### [Major] R3 — Runtime truth fields are assertions, not observations

Evidence:

- apps/web/src/editor/session/headless-semantic-fixture.ts:324 returns hostFallback: false as a literal.
- apps/web/src/editor/session/headless-semantic-fixture.ts:359 returns reactMountAttempts: 0 as a literal.
- apps/web/src/editor/session/headless-semantic-fixture.ts:361-365 observes only Worker, AudioContext, and object URL collections.
- script/check-headless-semantic-result.mjs:143 and 153-156 promotes those values into runtime pass claims.

The required runtime classes also include timers, compositor/shared GPU ownership, and React-root mounting. Static closure evidence independently supports React absence, but it does not turn a hard-coded runtime counter into an observation.

Impact: the evaluator can accept a fabricated no-fallback/no-React/no-C6-resource result. This blocks the “observed, not inferred” runtime requirement even though the focused data round trip itself passes.

Disposition: accepted, open, route to the non-author Sol fixer. Install probes before loading the subject, record every required class, and make the evaluator require probe provenance; otherwise remove claims that are not observed and adjust the spec explicitly.

### [Major] R4 — Protected regression closure is not green

Independent execution:

- Fresh root-base Vite production build: pass, 2,893 modules.
- Protected Vite editing-parity scenario: pass.
- C3 WebGL exact build/one-preview job: pass.
- C3 WebGPU exact build/two-preview job: failed twice at the same assertion, tests/c3/session-capacity.pw.ts:88, because data-migrating never remained observably true.
- A pre-edit baseline comparison did not reach ready and is not claimed as evidence.
- The protected Next editing-parity scenario was not completed. A fresh custom-dist Next build would rewrite protected apps/web/tsconfig.json, which this report-only reviewer was not authorized to edit.

Impact: full-session behavior after migration extraction and the exact WebGPU protected job are not independently green. The two current-tree failures must not be relabeled as inherited without a successful pre-edit control.

Disposition: accepted, open. Sol must isolate the WebGPU migration-state failure against the accepted base, fix product or oracle according to the result, then run both C3 backends and the unchanged parity scenario against both ordinary Hosts.

### [Major] R5 — Provenance and derived inventories are not closed

Evidence:

- tasks 11.4 and 11.12 remain open.
- PATCHES.md has no C7 entry for the new behavior under apps/web/src/editor/session and the Next/Vite proof path.
- SBOM.md and SOURCE_INVENTORY.md were not regenerated; the implementer explicitly records them as pending.
- The source inventory requirement requires a committed-tree regeneration, so an uncommitted implementation cannot truthfully satisfy it.

Impact: upstream behavioral modifications and the final committed file set are not yet auditable through the inherited provenance contract.

Disposition: accepted, open. After product fixes and the child commit identity exist, add observed patch-log/provenance records, regenerate SBOM/source inventory from the committed tree, rerun determinism and license/reference gates, and preserve the earlier pending record.

## Coverage and architecture

    headless API
       |
       +-- shared migration gate -------- focused migration suite PASS
       +-- load/save/dispose ------------ focused session suite PASS
       +-- Vite entry -> graph -> check -- BLOCKED: executable HTML omitted
       +-- Next route -> graph -> check -- BLOCKED: root chunk membership fabricated
       +-- runtime result --------------- BLOCKED: asserted counters
       +-- ordinary Hosts/C3-C6 --------- PARTIAL: WebGPU fail, Next parity pending
       +-- provenance/delivery ---------- PENDING: patch/SBOM/inventory/ship

The provider-private API remains limited to load, save, and dispose. The review found no React-barrel import, public port/store/schema widening, S03 transaction/revision/draft behavior, duplicated migration run, cross-project save acceptance, opaque/attachment loss, post-dispose write admission, or durable-data deletion.

## Independent checks

- C7 focused: 40 pass, 0 fail, 64 expectations.
- Full Bun suite: 430 pass, 8 inherited placement failures, 2 inherited loader errors, 1,358 expectations, 438 tests / 81 files. This exactly matches the implementer manifest; no new red identity appeared.
- Rust/WASM: 12 Rust tests pass; source/path/license/wiring pass; exact 38 JS exports, 58 binary exports, 609 imports and structural compile pass.
- Vite typecheck and pinned type baseline pass; the baseline reports exactly three inherited diagnostics.
- Static storage, Host, port, session-state, session-resource, runtime-asset, reference/license, and Next-import boundaries pass.
- Fresh ordinary Vite distributable boundary: 2,893 modules; all ten exclusions pass.
- Cross-Host emitted runtime inventory passes for the fresh Vite output and accepted ordinary Next output.
- Strict validation: child 1/1 and main specs 14/14, zero issues.
- git diff --check passes.
- Security review found no confidence-8/10 exploitable vulnerability; see cso-report.md.

TEST EVIDENCE
- scope: C7 focused suite, full repository Bun suite, Vite production/type/parity/C3, Rust/WASM, static boundaries, strict Rasen validation
- rationale: covers the new private API, migration/disposal concurrency, exact Host proof boundaries, inherited C3-C6 behavior, ordinary Host independence, and source/provenance gates
- command: see verification-report.md “Executed commands”; commands include bun test, the six-file focused bun test, cargo test --manifest-path rust/wasm/Cargo.toml, bun run check:wasm, both C3 Playwright jobs, Vite parity, static boundary scripts, and strict Rasen validation
- result: fail
- tree: 885d307814260b77397c2c2677b9361fdfc5f5e2

Round-1 conclusion: do not ship, integrate, sync, or archive. Tasks 12.5-12.7 are the next legal steps; 12.8 remains false.

## Round-2 fresh non-author supplement

Latest verdict: **BLOCKED — Blocker: 1, Major: 1, Minor: 0, Trivial: 0**.

R2, R4, and R5 are closed for the current pre-commit scope. R1 remains open because the Next
producer and checker accept a no-resource module whose `rawRequest` aliases the exact route. R3
remains open because the accepted runtime zeros do not each have a corresponding nonzero
sensitivity control. Complete evidence, 30-file inspection, 14-spec falsification sweep, and
`54 PASS / 3 FAIL / 5 UNVERIFIED` scenario result are in `review-round2.md`.

Tasks 12.6-12.8 and all 13.x tasks remain false. No ship, integration, spec sync, or archive is
legal.

## Round-3 fresh non-author final supplement

Latest verdict: **CLEAN — Blocker: 0, Major: 0, Minor: 0, Trivial: 0**.

This third fresh Sol-xhigh review inspected the complete 32-file authored delta, both earlier
review reports, both fix records, all final graph envelopes and all final runtime reports against
accepted base `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` / tree
`885d307814260b77397c2c2677b9361fdfc5f5e2`. The accepted base and product worktree HEAD/tree did
not move. The exact authored-set digest is
`e35913a746813342a7380a2fcfc00ea1df8aa4ec92234526f07fe058152ca657` over 32 sorted
repository-relative paths, NUL, raw bytes, NUL.

### Prior-finding disposition

- R1 Blocker is closed. Next root selection uses only normalized, query/hash-stripped
  `module.resource`; request, rawRequest, userRequest, and identifier are provenance only. The
  complete alias-only/no-resource producer envelope is rejected by the ordinary checker, while
  zero-root, wrong-entrypoint-owner, concatenated-owner, wrong-entry, and truncated-byte controls
  also fail closed. The exact-root plugin suite is `5/5`.
- R3 Major is closed. The pre-load probe records ordered install/load/bind/complete/restore
  provenance and distinct fields for every global, Host, React, WebGPU/WASM, and derived
  compositor/GPU observation. The evaluator rejects every fabricated clean field, bad strategy or
  order, an installed-but-zero hook, fabricated browser React evidence, copied Hosts, and
  incomplete cleanup. Real Vite and Next sensitivity reports pass their availability-aware
  validators.
- Earlier R2, R4, and R5 closures remain valid. Vite executable-HTML binding is enforced; protected
  Vite and Next parity each passed `1/1`; exact-base and current WebGPU runs retain the same
  unchanged `tests/c3/session-capacity.pw.ts:88` oracle race while current WebGL passes; patch and
  provenance records are present. Round-2 changes are confined to the C7 proof/evaluator path and
  do not modify the protected parity, GPU, compositor, Rust/WASM, public-port, or session-type
  surfaces.

### Independent final evidence

- Focused eight-file C7 matrix: `90 pass / 0 fail / 123 expectations`. This includes all
  field-by-field semantic negatives, the full producer-to-checker alias-only regression, migration,
  disposal, React-free boundary, and cross-Host semantic coverage.
- Final Vite clean graph `6eaf3a78...`: accepted, `15` emitted modules, canonical checker digest
  `24c741d1...`. Final Next clean graph `078b16dd...`: accepted, `16` emitted modules, canonical
  checker digest `4c009c9d...`. The clean cross-Host semantic evaluator passes.
- Final Vite sensitivity graph `1a7cf5bc...` exits `1` for exactly `19` React-family identities and
  its runtime sensitivity validator passes. Final Next sensitivity graph `69187000...` exits `1`
  for exactly one injected React identity and its server/no-DOM sensitivity validator passes.
- Full repository Bun suite: `480 pass / 8 inherited fail / 2 inherited loader errors / 1,417
  expectations / 488 tests / 83 files`. The six `ZERO_MEDIA_TIME` placement failures and two
  accepted loader-error identities are unchanged; no C7 test fails.
- Vite typecheck passes. The pinned root type gate passes with only the exact three inherited
  diagnostics. All eight static boundary commands pass. Targeted authored source Prettier passes;
  targeted ESLint reports zero errors (six expected ignored/no-config warnings); all three C7 MJS
  entrypoints pass `node --check`; `git diff --check` passes. An optional repo-root Markdown
  Prettier expansion would reflow `BOUNDARIES.md` and `PATCHES.md`, but no documented project gate
  formats those root documents and this is not a correctness finding.
- `bun run check:wasm` passes source/freshness/license/wiring, path/privacy controls, and exact
  `38` JS exports / `58` binary exports / `609` imports. Rust passes `12/12` plus doc tests with
  `CARGO_TARGET_DIR=C:/Users/Sayo/cargo-target`.
- Protected editor ports, public session types, parity/type fixtures, Rust/WASM, GPU/compositor,
  and generated JS/WASM identities exactly equal the cold baseline; protected `git diff --quiet`
  exits `0`. No lockfile changed. Only retained port `4174` is listening, owned by pre-existing PID
  `44516`; it was not touched.
- Strict Rasen validation passes the child `1/1` and main specs `14/14`, with zero issues.

### Standards and spec axes

- Standards: `0` findings; worst issue: none.
- Spec: `0` findings; all `14/14` requirements and `62/62` scenarios are represented. The final
  causally valid state is `59 PASS / 0 FAIL / 0 UNVERIFIED` pre-delivery plus `3 PENDING` delivery
  scenarios (separate Luna ship, fresh LEAD integration, archive after accepted spec sync).

TEST EVIDENCE
- scope: full C7 delta, prior findings, exact final Host artifacts, focused/full regression,
  protected identities/parity/C3 evidence, Rust/WASM, static/type/format, and strict planning
  validation
- rationale: independently falsifies both round-2 fixes and reconfirms every earlier material
  closure without requiring delivery artifacts before the legal ship leaf
- command: focused and full `bun test`; exact graph and semantic checkers; Vite/root type gates;
  eight static boundaries; `bun run check:wasm`; Rust tests; targeted ESLint/Prettier/node syntax;
  protected Git/hash audit; both strict Rasen validations
- result: pass, with only the exact accepted inherited full-suite identities
- tree: `885d307814260b77397c2c2677b9361fdfc5f5e2`

Tasks 12.6, 12.7, and 12.8 are now true: the review is clean, all 59 pre-delivery scenarios pass,
both clean Host artifacts were rebuilt after controls, affected gates and strict validation pass,
and the three necessarily later workflow scenarios remain explicitly pending. Tasks 13.1-13.10
remain false. This reviewer performed no product/test/tooling edit, commit, ship, integration, spec
sync, archive, port termination, or artifact deletion.
