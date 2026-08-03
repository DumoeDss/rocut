# C5 final parity sidecar repair — Phase 6 topology and Chromium

Date: 2026-08-04 +08:00  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`  
Status: author Phase 6 browser-proof evidence; reviewer-required cleanup remediation is implemented; independent re-review remains required

## Scope and pre-edit RED/evidence gap

The complete sidecar design, its Phase 6 contract, repository instructions, and
the Phase 5 migration/recovery evidence (including its explicit topology
supersession) were cold-read before editing. The Phase 6 product invariant was
already implemented: `browserProjectTopologyStoreNames()` already derived and
reserved the project-authority store pair.

The unedited focused selector was run first, with no listener on port 4175:

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts \
  apps/vite-example/tests/c5-storage/browser-store.pw.ts \
  --grep "BrowserProjectStore passes the complete shared matrix"
exit 0 — 1 passed
store: 19 passed / 0 failed / 0 skipped
cascadeRound2: 33 boolean fields, all true
inventory: before [] databases / [] directories; after [] / []
```

This was an evidence-gap RED baseline, not proof of the new claims. The
real-browser reserved-pair probe omitted `stores.authority`, and the media
refusal probe only asserted the `unavailable` error, project retention, and no
maintenance rows. It did not observe attachment sidecar IDB stores or OPFS
access. No product defect was inferred.

## Browser-proof repair

Only `apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts`
was changed in this Phase 6 leaf. No product persistence/topology implementation
was changed; the existing topology module already contained the authority name
and reservation policy. The harness and Playwright spec needed no field changes.

### Reserved project-authority pair

`probeTopologyLibraryReservedPairs` now tests all six canonical project-store
names atomically: `public`, `authority`, `cascade`, `mediaOwnership`,
`libraryClearBindings`, and `migrationMaintenance`. It seeds one sentinel in
each `(projectsDatabase, store)` pair, attempts the corresponding library claim,
requires a stable `ProjectStoreError(unavailable)`, and verifies every sentinel
survives. The `authority` sentinel is therefore part of the real Chromium
reserved-pair claim, not only a unit-topology assertion.

### Media access before the whole-database permit

For both the forbidden `load` and `save` cases, the probe snapshots the target
database version/object-store list and target OPFS directory inventory, then
observes the action in a narrow window:

- `IDBFactory.prototype.open` counts opens of the target database;
- `IDBDatabase.prototype.transaction` counts transactions naming either the
  media public store or the derived attachment-authority store;
- `StorageManager.prototype.getDirectory` counts all OPFS-root access.

The target database intentionally aliases the projects database, so ordinary
project/cascade checks are allowed to open it. The acceptance condition therefore
does **not** require zero target-database opens. It requires zero sidecar-store
transactions, no database version/object-store change (including no creation of
the two sidecar stores), zero OPFS-root calls, and an absent target directory
before and after. The refusal must still be `unavailable`, preserve the project
row, and leave maintenance empty.

An isolated sensitivity control runs through the same instrumentation before
each real action: it opens the existing target database, attempts a transaction
against the deliberately absent authority store (catches the expected
`NotFoundError`), and calls `getDirectory` without creating a directory. It
produced `sensitivity=1/1/1`; the real actions produced
`observed=2/0/0` for both load and save (two allowed shared-project opens, zero
sidecar transactions, zero OPFS-root accesses). Counters are reset by restoring
the original descriptors before each real action, so a forbidden access that
still returned the same `unavailable` error cannot pass this proof.

### Reviewer-required fail-safe descriptor remediation

The independent Phase 6 review identified a Major exception-path gap in the
first observer: a partial `Object.defineProperty` installation could leave an
earlier global wrapper behind, and a restoration throw could skip later
restorations. The observer now starts its cleanup guard before the first
prototype mutation, records only successful installations, and never runs the
action after an incomplete installation. Cleanup attempts every recorded
descriptor independently, retries each failed restoration once, compares the
effective descriptor (including method identity) with the original, and
preserves/rethrows both primary and cleanup errors through an aggregate error.

The real Chromium probe now injects a one-shot `Object.defineProperty` fault at
each of the three install positions and each of the three restore positions.
After every fault it compares `IDBFactory.prototype.open`,
`IDBDatabase.prototype.transaction`, and the storage prototype's
`getDirectory` against their originals, then runs the sensitivity control and a
normal load/save refusal. All 12 cases (six for load and six for save) recorded
`fired=true:restored=true:subsequent=true`; no wrapper survived and every
subsequent observation remained `sensitivity=1/1/1` versus `observed=2/0/0`.
This remediation changed only the existing probe module; no product,
harness/spec, task/runstate, parity, or Phase 7 files were edited.

## Verification

Focused units/static gates:

```text
bun test .../browser-project-store-records.test.ts                    10 pass / 72 expects
bun test conformance + opaque-roundtrip + media persistence             32 pass / 184 expects
bun test .../c5-storage-red-controls.test.ts                             1 pass
browser-project-store-topology.test.ts                                  12 pass / 64 expects
browser-project-store-media-topology.test.ts                              7 pass / 74 expects
browser-project-store-cascade-topology.test.ts                            7 pass / 48 expects
browser-project-store-migration-topology.test.ts                          9 pass / 37 expects
v1-to-v2 + migration-provider-private                                   19 pass / 46 expects
node script/check-type-baseline.mjs                                     PASS — exact 3 diagnostics
node script/check-port-boundary.mjs --negative-control                  PASS
node script/check-host-composition.mjs --negative-control                PASS
node script/check-storage-boundary.mjs                                   PASS — 723 modules, 0 unexpected hits
```

The first post-proof ESLint invocation exposed two probe-only
`@typescript-eslint/no-unsafe-type-assertion` findings (the temporary
`Object.getPrototypeOf(... ) as object` and `Reflect.apply(...) as IDBTransaction`
casts). They were removed with an `unknown` prototype guard and an
`instanceof IDBTransaction` check. The required final command then passed with
zero errors (repository's existing missing-pages notice only), followed by a
fresh exact-three type check, Prettier check, focused Chromium rerun, and the
reviewer-required descriptor fault controls described above.

Each topology file ran in its own Bun process. Before the reviewer-required
descriptor remediation, the focused Chromium selector
passed 1/1 with the new authority and physical-access proofs. The complete C5
configuration then passed all five tests:

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
5 passed (1.0m) — final rerun after the ESLint cast fix
complete shared matrix: store 19/0/0; migrationRound2 30 booleans true;
  cascadeRound2 33 booleans true; lifecycle races 16 / 0 failures
disposable inventories: before [] databases / [] directories;
  after [] / []
```

After the reviewer-required fail-safe descriptor remediation, the focused
shared-matrix selector passed 1/1 (31.8s; Chromium 151) and the complete C5
configuration passed 5/5 in 1.1m. The cascade cleanup proof contained all 12
descriptor-fault traces with
`fired=true:restored=true:subsequent=true`, plus the load/save physical-access
traces.

Pre-run port 4175 was clear. Afterward ports 4175, 4177, 43551, and 43552 were
clear, and no `node.exe`/`bun.exe` command line containing `rocut-wt-c5` remained.

Protected parity sources remained unchanged:

```text
parity tree  e1fbb55b985f4fb490c6b233d18c50c58ea14c28
oracle blob  fa387ebea1e7f0cc1110eebcb922d393a1337842
```

No commit, staging, task checkbox/runstate edit, harness/spec change, product
code change, parity fixture/oracle change, or Phase 7 work was performed.
Phase 7 (fresh Vite/Next builds and protected 195/0/9 parity) remains pending.
