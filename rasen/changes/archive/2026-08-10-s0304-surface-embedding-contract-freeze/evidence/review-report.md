# Independent review report — `s0304-surface-embedding-contract-freeze`

**Mode:** dispatched / report-only  
**Reviewer role:** fresh Codex-native non-author reviewer  
**Review date:** 2026-08-10  
**Current branch:** `recovery/s0304-ui-commit-routing-final`  
**Current HEAD:** `95cb64538e12a6d35675af50fb0de5766e12c4a5`  
**R0 original base:** `d84d9d50b718aa3c85c76ec762febcb5db0286ff`  
**R0 reconstructed tree:** `3e1cce7fc0e95e4221d1911b558167408198378a`

## Verdict

**PASS WITH ACCEPTED-KNOWN TRIVIAL — 0 Blocker / 0 Major / 0 Minor / 1 Trivial.**

There is no unresolved Blocker or Major in the R0 recovery delta. The exact
two-file product recovery is suitable for the change's ship/archive decision.
The one Trivial item is an exact-byte-preservation exception, not a request to
alter the recovered files.

The current integrated checkout has inherited, non-R0 red identities: a broad
root-TypeScript invocation reports 114 diagnostics and the freshly generated
cross-Host parity comparison reports 20 semantic differences in later
`__opencutTransaction.idempotency` state. Both are reproduced and attributed
below. Neither touches, imports, or bundles the R0 embedding module; neither is
counted as an R0 finding. They must not be cited as clean integrated gates.

## Finding counts

| Severity | Open | Accepted-known | Total |
| --- | ---: | ---: | ---: |
| Blocker | 0 | 0 | 0 |
| Major | 0 | 0 | 0 |
| Minor | 0 | 0 | 0 |
| Trivial | 0 | 1 | 1 |

### T1 — accepted-known: unused type-only import

**Severity:** Trivial  
**Location:** `apps/web/src/editor/surface/embedding/types.ts:17`  
**Evidence:** focused ESLint reports
`@typescript-eslint/no-unused-vars` for `EditorSessionRootHandle`, with 0 errors
and 1 warning.

The import is type-only, emits no runtime dependency, and the module has no
outside consumer. Removing it would change the required transcript-exact
SHA-256, Git blob, and reconstructed tree. It is therefore accepted as an
exact-recovery preservation item.

## Scope and identity proof

The reviewed product delta is the original base plus exactly these two added
files; the current branch's later integrated changes are not part of the R0
scope.

| Product path | Bytes | SHA-256 | Git blob | Result |
| --- | ---: | --- | --- | --- |
| `apps/web/src/editor/surface/embedding/types.ts` | 12,969 | `191d8ce880dc4807c90f8ff9113333c4e6992d1e4274bcc756a62a6cad3d5379` | `5bbfc48d3a1dc0af71275ce1dccad71df0f2d167` | exact |
| `apps/web/src/editor/surface/embedding/index.ts` | 419 | `81a514fa12be1e5d19d25d816f13de3a9122de61771df1de0c1abe6c844cb313` | `bfbf6f6fdb54813d5c9d252cbb5bdc0ca385e57a` | exact |

Independent temporary-index proof, using no live index/ref/branch mutation:

```text
base commit:        d84d9d50b718aa3c85c76ec762febcb5db0286ff
base tree:          3d7c5e3a76db7665f5571723f72e40d2388c88ce
reconstructed tree: 3e1cce7fc0e95e4221d1911b558167408198378a
delta:
A apps/web/src/editor/surface/embedding/index.ts
A apps/web/src/editor/surface/embedding/types.ts
numstat: 17/0 + 339/0 = 356 insertions, 0 deletions
git diff --cached --check: exit 0
```

The live index SHA-256 was
`7c4ba0c82f16d54102af5d884a056effa1797a45b7b261e6c83de9dfe3e9dfbf`
before and after both temporary-index proofs. HEAD remained `95cb6453...`, the
branch remained `recovery/s0304-ui-commit-routing-final`, and each temporary
index was removed.

Both product files strictly decode as UTF-8, have no BOM, contain no U+FFFD,
use LF only, and retain a final LF. `types.ts` has 339 LF and 0 CRLF;
`index.ts` has 17 LF and 0 CRLF.

## Scope check

**Intent:** freeze the public Surface embedding types and decisions only,
without component wrapping, CSS emission, event registration, Host-port,
command, transaction, or session implementation changes.

**Delivered:** exactly two additive files under the owned
`apps/web/src/editor/surface/embedding/**` directory. The temporary-index delta
contains no existing-file modification and no `contracts/` addition.

**Result:** CLEAN — no scope creep and no missing task-owned product file.

## Contract and boundary audit

Nine in-memory TypeScript contract assertions compiled with 0 diagnostics:

- `FocusMode` is exactly `"passive" | "focused" | "full"`.
- `EditorSurfaceProps` has exactly the nine specified keys.
- `session` is the only required prop.
- `SurfaceCommitBinding.commit` accepts exactly `{ edit: unknown }` and returns
  `void`.
- `CssNamespaceStrategy` has exactly `namespaceAttribute`, `containment`, and
  `noBodyOwnership`; the latter two retain their required literal types.
- `SurfaceLifecycleBinding` has exactly `mount`, `suspend`, `resume`, `unmount`,
  and `dispose`.

The lifecycle strings map those five keys to the current and original-base S02
session calls: `session.mount({ target })`, `session.suspend()`,
`session.resume()`, `session.unmount()`, and host-driven
`session.dispose()`. The S02 interface still returns
`EditorSessionRootHandle` synchronously from `mount`, exposes asynchronous
`ready`, and distinguishes reversible unmount from disposal.

AST inspection found only two imports, both type-only:

```text
EditorSession           from @/editor/session
EditorSessionRootHandle from @/editor/session/session-types
```

There are no forbidden exported type identifiers among `Transaction`,
`Revision`, `IdempotencyKey`, `Batch`, `Operation`, OpenCut schema types,
Zustand, IndexedDB, or OPFS names. The module contains 0 call expressions,
0 `new` expressions, and 0 JSX nodes.

### A1 opaque commit seam

**PASS.** The public seam is exactly
`commit(args: { edit: unknown }): void`. No transaction/domain module is
imported and no T0 type is named. R0 exposes the consumer slot without taking
ownership of T0's transaction contract.

### A2 React ownership

**PASS.** R0 imports no React package, creates no component/root/provider, and
makes no runtime-sharing decision. Shared React ownership remains downstream
R2 work.

### Public contract leakage

**PASS.** Public types are limited to `EditorSession`, platform-standard
`Error`, callbacks, and Surface-local types. There is no router, page, auth,
viewport class, command class, store, persistence identity, or filesystem path
in the public type graph.

## Requirements and tasks

The delta spec contains 9 requirements and 24 scenarios. All were checked
against the source and the S02 interfaces. The type shapes, focus union and
container-only decision, CSS namespace guarantees, five lifecycle mappings,
optional opaque commit slot, additive-only boundary, Host neutrality, and lack
of Surface-owned save semantics are represented without contradictory public
types.

`tasks.md` contains 15/15 checked tasks, and
`rasen instructions apply --change s0304-surface-embedding-contract-freeze
--project rocut --json` reports `all_done`, 15 complete, 0 remaining.

The current checked `tasks.md` hash is
`6a419c7eaede9fb709fe6a96419e7e35e65101a2fe50bf59b06a4c3379456fde`.
Replacing only its 15 `[x]` markers with `[ ]` reconstructs the preserved
planner hash
`7b0dc0bf2cd63f1d64fff22d7d670929c38c327d7cc4c1c7613999a6ba2146b4`.
The checkbox-only workflow update is therefore accounted for rather than
misreported as planning-body drift. Proposal, design, and delta-spec hashes
match their recovered provenance exactly.

`rasen validate s0304-surface-embedding-contract-freeze --strict --project
rocut --json` passes: 1 item passed, 0 failed, no issues.

## Gate results

| Gate | Result | Reproduced evidence |
| --- | --- | --- |
| Focused contract TypeScript | PASS | Two product files + two repository ambient declarations, TypeScript 5.9.3: 0 diagnostics. |
| Virtual type-shape assertions | PASS | 9 assertions: 0 diagnostics. |
| Pinned type baseline | PASS | `node script/check-type-baseline.mjs`: 3 current diagnostics, 13 at pin, no diagnostic outside baseline. |
| App compiler raw run | ACCEPTED BASELINE | TypeScript 5.9.3 exits 2 with 3 diagnostics, all outside `surface/embedding`: `next.config.ts` plus two timeline tests. |
| Vite typecheck | PASS | `bun x tsc --noEmit -p apps/vite-example/tsconfig.json --pretty false`: 0 diagnostics. |
| Focused ESLint | PASS WITH T1 | 0 errors, 1 unused type-import warning. |
| Next production build | PASS | Next 16.1.3 compiled, generated 19/19 static pages; CI placeholder env only. |
| Vite production build | PASS | 2,920 modules transformed; existing chunk-size warning only. |
| Vite parity scenario | PASS | 1/1 in 42.5 seconds; 10/10 interactions evidenced, 0 failed, 0 missing. |
| Next parity scenario | PASS | 1/1 in 40.8 seconds after the documented CI placeholder env was supplied; 10/10 interactions evidenced, 0 failed, 0 missing. |
| Current cross-Host snapshot comparison | INHERITED FAIL, not R0 | 29 differences: 20 semantic, 9 incidental, 275 leaf values. Every semantic path is under `project.__opencutTransaction.idempotency`. |
| Rasen strict validation | PASS | 1 passed, 0 failed. |
| Whitespace / UTF-8 | PASS | strict UTF-8, LF-only, final LF, no BOM/U+FFFD; temporary-index `git diff --check` exit 0. |

The first attempted Next parity run is excluded from gate evidence: the server
was intentionally started without the repository's CI placeholder environment,
and `/editor/...` returned HTTP 500. After loading the checked-in workflow's
non-secret placeholder values, `/projects` returned HTTP 200 and the identical
scenario passed. Only reviewer-owned port 31840/processes were stopped; the
pre-existing VS Code process on ports 3000/3001 was preserved.

Fresh parity artifact SHA-256 values:

```text
Vite  007df9cb202eaf464667eff8c74e4e0d6ea6d3f80a64e8af90b027442b340fa6
Next  6b9b1f8f15925923bb964f9a702c2f438b8396e6f7a610a582ae286a060cffbe
```

The Next ledger records one blocked third-party analytics request and two
corresponding resource-load console errors; the Vite ledger records neither.
All ten accepted editing interactions pass in both Hosts.

## Integrated-tree attribution

The broad root command
`bun x tsc --noEmit -p apps/web/tsconfig.json --incremental false --pretty
false` reports 114 diagnostics under the root TypeScript toolchain, including
missing `bun:test`/`Bun`, a missing Vite `ImportMeta.env`, and the existing Next
type-identity mismatch. It reports **0 diagnostics** under
`surface/embedding`. The repository's pinned-baseline command is the governing
gate and passes.

The fresh current-tree parity comparator fails because later transaction
routing persists nondeterministic idempotency keys/fingerprints and created-ID
order. `__opencutTransaction` is absent at the R0 base and enters history in
later commit `14797382` (`recovery(s03-t3): replay UI transaction routing before
prerequisite merge`). The R0 embedding names have no consumer outside their
own two files, and fresh Vite and Next build outputs contain no embedding
module/name. Thus the 20 semantic rows are reproducible integrated-tree state,
but not an R0 regression.

As an independent baseline cross-check, `PARITY.md` at the exact R0 base records
9 incidental, 0 semantic differences across 195 leaf values. Because the exact
R0 tree adds only an unreachable module, its runtime graph is the base graph;
no parity re-baseline is implied.

## Spec-falsification sweep

The keyword sweep was rerun over all 13 current main specs and compared with
the exact base's 12-spec tree. No current assertion is contradicted:

- `editor-session-runtime`: the five lifecycle calls, synchronous root handle,
  readiness signal, provider ownership, and unmount/dispose distinction remain
  consumed rather than redefined.
- `host-service-boundary` and `host-port-contract`: the optional Surface-local
  commit slot adds no Host service or port role.
- `headless-editing`: the embedding module is absent from the headless/runtime
  consumer graph and changes no frozen session or Host surface.
- asset, persistence, disposal, state-isolation, WASM, provenance, and
  reproducibility capabilities receive no runtime/import edge from R0.

`next-free-distributable-boundary` is absent from both the current main-spec set
and exact R0 base, so it cannot be presented as a current filesystem proof.
The still-current `editor-root.tsx:35-40` and `BOUNDARIES.md:80-85`
independently preserve its relevant parent-container and Radix
`document.body`-portal statements, and R0 is consistent with them. The original
15-spec sweep remains static transcript provenance only, not current proof.

The historical verifier transcript at
`C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-elftia-elftia-elftia/432c1542-4f82-4b60-9f4f-9661c69cec61/subagents/agent-averify-r0-b5257173b37cc21c.jsonl`
was read only as a cross-check (SHA-256
`512ac0bf3a0083f4e8d460a49cb66f08d7b576f335d2fbe1b8d423a23ed391cd`).
No Claude command/runtime was invoked, and none of its historical PASS claims
was used as current evidence.

## Standards axis

No SQL/data write, concurrency, LLM trust-boundary, conditional side effect,
crypto, time-window, coercion, view, dependency, asset, or runtime performance
path is introduced. The exact focus enum has no existing consumer that can omit
a new case. The only standards item is accepted-known T1.

**Standards count:** 0 material; worst item Trivial T1.

## Spec axis

The exact two-file recovery matches proposal, design, delta spec, and every
task-owned product shape. A1 and A2 ownership are preserved. No required R0
runtime wiring was omitted because runtime wiring is explicitly R1/R2 work.

**Spec count:** 0 findings; worst item none.

## Coverage

```text
CODE PATH COVERAGE
==================
[+] embedding/types.ts
    └── [N/A] declarations + compile-time-readonly mapping data; 0 calls, branches, new, JSX
[+] embedding/index.ts
    └── [N/A] re-exports only

USER FLOW COVERAGE
==================
[+] R0 contract freeze
    └── [N/A] no mounted component or user flow exists in this change

Executable paths changed: 0
Runtime consumers added: 0
Coverage gaps: 0
```

The diff touches `.ts` contract files only; browser design review is not
applicable. The large-diff external Codex pass was not invoked because this
reviewer is already the fresh Codex-native independent pass and the live branch
diff includes unrelated integrated work; an external `--base` review would not
represent the exact temporary-index R0 delta.

## Final ship condition

R0 has **0 unresolved Blocker and 0 unresolved Major**. T1 is explicitly
accepted-known for byte identity. The broad root-TypeScript and current
transaction-parity observations remain visible for their owning integrated
workstreams and are not silently converted into R0 PASS claims.
