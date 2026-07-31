> Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c1`, branch
> `feat/s02-port-contract-freeze`, branched from `main@49f8a88a`.
> Planning artifacts live in the main checkout (`rasen/` is gitignored in `rocut`) and are never
> committed. Commits contain code only.
>
> **Standing constraints.** `script/fixtures/type-baseline.json` must not be edited by this change.
> The type-baseline ceiling is **3**; a count above 3 or a `FAIL` is a stop condition escalated to
> the LEAD, never a re-baseline. Both Hosts stay green and **parity must not move** — this change
> wires nothing, so movement means something was wired. This child runs concurrently with
> `s02-wasm-self-built-canonical`, which writes `rust/**`, both manifests, `bun.lock`, both Hosts'
> build configs, `UPSTREAM.md`, `SBOM.md`, `PATCHES.md` and `script/generate-sbom.mjs` — **if this
> change finds it must write any of those, stop and report rather than proceeding.**
>
> **Scope fence.** `EditorCore.getInstance()` stays (C2). `apps/web/src/editor/use-editor.ts` is not
> touched (C2/C3). `BrowserHostAdapter` is not retired (C5). No `rust/` file (C0b). No manager,
> command, store or service body. If the contract appears to require a public transaction, revision
> or draft concept, that is **S03 leaking in** — stop and bring the boundary back to Direction.

## 0. Baseline, on the unmodified tree, before any edit

- [x] 0.1 Create the worktree from `main@49f8a88a`; confirm `git rev-parse HEAD` and
      `HEAD^{tree}` are `49f8a88a` / `97097f0a`. Record both.
- [x] 0.2 `bun install` at the repository root. Record package count and whether `bun.lock` was
      rewritten; **do not commit lockfile churn** — the lockfile belongs to the concurrent C0.
- [x] 0.3 Run `node script/check-type-baseline.mjs` on the **unmodified** baseline and record the
      output verbatim. Expected: *"3 diagnostic(s) now, 13 at the pin cf5e79e9 … PASS"*. **A
      different result is a stop condition — escalate to the LEAD, do not proceed.**
- [x] 0.4 Build both Hosts on the unmodified baseline and run `bun run test:parity` in
      `apps/vite-example`. Record pass/fail per step and archive the snapshots as the comparison
      baseline for task 7. **A baseline parity failure is a stop condition surfaced to the LEAD, not
      something to work around** — it is the regression oracle for every child in this Slice.

## 1. Read the surfaces the contract must cover, before designing against them

- [x] 1.1 Enumerate `storageService`'s public methods (`apps/web/src/services/storage/service.ts`)
      and classify each into projects / media assets / saved sounds / quota / support probes. This
      classification is the input to the `ProjectStore`-versus-other-ports split, and design open
      question 3 records that the split may not survive C5.
- [x] 1.2 Record the exact shape of the single `new Worker(...)` site
      (`apps/web/src/services/transcription/service.ts:114`) and of the ten
      `URL.createObjectURL` sites, so the registry's acquisition signatures are derived from real
      call shapes rather than invented.
- [x] 1.3 Record `RendererManager`'s existing `isDegraded` / `setDegraded` and where
      `editor-root.tsx` renders the degraded banner. The no-rasterizer path must drive state that
      already exists, not introduce a parallel one.
- [x] 1.4 Record what `EditorCore`'s constructor owns (twelve managers, three default-registration
      calls, `save.start()`), so the session contract can express it without C1 implementing it.

## 2. The port surface

- [x] 2.1 Create `apps/web/src/editor/ports/` with one entry point. Declare every Target State §5.5
      role: `ProjectStore`, `AssetResolver`, `RuntimeAssetLoader`, `ExportProvider`,
      `NavigationHost`, `Logger`/`Diagnostics`, `IdGenerator`, `EnvironmentCapabilities`.
- [x] 2.2 Widen `apps/web/src/editor/host/editor-host.ts` to compose those roles, **preserving
      `projectId` / `navigation` / `services` / `branding` / `links` verbatim** so both Hosts keep
      compiling with no change to how they supply them. Update the file's header, which currently
      says it is *"deliberately not a Host port contract"* — that sentence becomes false here and
      must not be left standing.
- [x] 2.3 `ProjectStore` carries an **opaque** project payload plus a typed summary
      (`{ id, name, createdAt, updatedAt, thumbnail? }`). No OpenCut schema type crosses the port.
      This is what protects the Slice stop condition *"storage inversion cannot preserve
      provider-private round-trip"* — an opaque payload round-trips unknown fields by construction.
- [x] 2.4 `ExportProvider` and `IdGenerator` are declared with their semantics recorded as owned
      elsewhere (S08 and C7/S03 respectively) rather than omitted — a declared role a Host can see is
      better than a Target State role that silently is not there.

## 3. Worker, root handle, graphics, disposal, migration — decide and record

- [x] 3.1 **Worker.** `createWorker({ id, url, type, name? })` returns a `WorkerHandle`; the editor
      never constructs a Worker. Record in the decision record that the supplied URL is a *request a
      Host may rewrite*, and why: E0 measured the packaged-Elftia refusal as the **same-origin rule**
      (`SecurityError … cannot be accessed from origin 'app://bundle'`) and **no CSP token can fix
      it**, so a port that constructs from the editor's own origin is unimplementable by the one Host
      this workstream exists to serve.
- [x] 3.2 **Root handle.** `mount(target)` returns the handle **synchronously**, with `ready` as a
      promise on the handle. Record why: mounting awaits GPU initialisation, and a
      `Promise<Handle>` would leave a Host with nothing to unmount during a slow or failed mount —
      a more general form of the exact gap E0 hit. Specify idempotent `unmount()`, `dispose()`
      implying unmount, and **one live root per session** (mounting a mounted session throws).
- [x] 3.3 **Graphics.** Split Host declaration from runtime report: `EnvironmentCapabilities`
      exposes `describeGraphics(): { mode: "detect" } | { mode: "force"; rasterizer: "none" }`;
      `session.capabilities.graphics()` returns the report, carrying `rasterizer`, the selected
      `backend` and `livePreviewLimit`. The Host declares; the Host never asserts the report.
- [x] 3.4 **`livePreviewLimit` is a count, not a flag** — the Slice Plan names this exact failure
      (*"C1 declaring, say, a preview count while C0b exports a boolean"*). Declare the runtime query
      C0b must supply: selected backend as an **enumeration**, plus concurrently drivable compositor
      instances. Land a temporary implementation reporting `livePreviewLimit: 1` with an explicit
      `source: "unimplemented"` marker, so C0b satisfies a declaration that already exists and an
      incompatible pair **fails to compile** rather than at runtime.
- [x] 3.5 **Disposal.** `SessionResources` **mediates acquisition** — timers, workers, audio
      contexts, object URLs and graphics resources are obtained from it, not registered after the
      fact. Record why: Elftia's `PluginDisposerRegistry` tracks only explicitly registered disposers
      and is blind to all five classes, and a register-after-the-fact API inherits that blindness by
      construction because a forgotten call is invisible. The five classes are **named types, not a
      generic list**, so an empty class reads as an explicit zero.
- [x] 3.6 `dispose()` is idempotent, releases in reverse acquisition order, and returns a report with
      **created and released counts per class**. Record why "created" is in the report: E0's numbers
      were unusable because Workers, audio and object URLs were never created there, so they were
      **unmeasured, not clean** — C6 must be able to show "created before asserted released"
      mechanically.
- [x] 3.7 **Migration.** `ProjectStore` declares `schemaVersion` and an optional `migrate(...)`; the
      session invokes it **once** during `create`, before any project load, and surfaces progress
      through the diagnostics port. Record the rejected alternative (session-owned migration: a
      second session re-runs or races it) and the consequence that a session-scoped progress channel
      is what later lets `MigrationDialog` observe a migration at all — the dialog's repair is C3's,
      but it is unachievable while progress stays global.
- [x] 3.8 Write the decision record to `apps/web/src/editor/ports/DECISIONS.md`, covering 3.1, 3.3,
      3.5 and 3.7, each with the measurement or constraint that forced it **and the alternative that
      measurement rules out**. Sited inside `apps/web/src/editor/` deliberately, to keep this
      change's write set inside its declared boundary during the concurrent window with C0.

## 4. Session contract

- [x] 4.1 Create `apps/web/src/editor/session/` with the session type, its dependency object, and the
      lifecycle operations `create` / `mount` / `suspend` / `resume` / `unmount` / `dispose`, each
      declaring which states it is valid from and what it does when called out of order.
- [x] 4.2 Ensure the session type cannot express a never-updating snapshot consumer. `useEditor()`
      with no selector currently subscribes with `subscribeNone`
      (`apps/web/src/editor/use-editor.ts:19,72`) — do **not** edit that file, but do make the
      session's read surface one where the no-subscription form is unavailable, so C3's repair has
      somewhere to land and the shape cannot be reintroduced through the contract.
- [x] 4.3 Declare the resource registry's five classes with their acquisition signatures, derived
      from the call shapes recorded in 1.2.

## 5. Reference implementation and conformance suite

- [x] 5.1 Implement every port in memory — **working, not stubbed**. The in-memory store must
      genuinely round-trip an opaque payload including fields it does not interpret; a store that
      returns fixed values proves nothing about the port.
- [x] 5.2 Write the conformance suite so an adapter author can point it at any implementation
      without modifying it, reporting pass/fail per port and per case. C5's second store and E1 are
      its intended future callers; if a port cannot be implemented twice, it is not a port.
- [x] 5.3 Run the suite green against the in-memory implementation and record the output.
- [x] 5.4 Include a no-rasterizer conformance case: a Host declaring `{ mode: "force", rasterizer:
      "none" }` yields a report with `livePreviewLimit: 0` and a stated reason. This is the seam
      §3.5 needs so that C4 can observe the degraded-renderer state without special hardware — S01
      could never reach a configuration that rendered it.

## 6. Make the boundary rule mechanical

- [x] 6.1 Write `script/check-port-boundary.mjs`: an import allowlist over the ports module's graph
      (no `@/project/types`, `@/timeline/*`, `@/commands/*`, `@/services/storage/*`, no state store)
      plus a literal scan for `indexedDB`, `video-editor-`, `navigator.storage`, `getDirectory`.
- [x] 6.2 Extend it with the converse assertion D2/D5 depend on: no editor-graph module constructs a
      `Worker` or `AudioContext`, or calls `URL.createObjectURL`, outside the registry. **Scope this
      to the ports/session modules for now** and record that the editor-wide form becomes enforceable
      only once C4/C6 have rewired the existing sites — asserting it repo-wide today would fail on
      code this change is forbidden to touch.
- [x] 6.3 Add the **negative control**: a fixture that deliberately violates each rule must be
      caught, per violation. Record the control's output. A check that cannot fail is not evidence,
      and every other boundary check in this repository carries one.

## 7. Evidence and gates

- [x] 7.1 Type-check and build both Hosts. Run `node script/check-type-baseline.mjs`: ceiling **3**,
      `PASS`. A count above 3 or a `FAIL` stops the child and is escalated — never re-baselined, and
      `script/fixtures/type-baseline.json` is not edited.
- [x] 7.2 Run `bun run test:parity` in `apps/vite-example` and compare against the 0.4 snapshots with
      `script/diff-parity-snapshots.mjs`. **Expected: unchanged.** This change wires nothing, so any
      movement means something was wired — report it, do not re-baseline.
- [x] 7.3 Re-run every existing check script and record each result: `check-asset-manifest.mjs`,
      `check-storage-boundary.mjs`, `check-next-imports.mjs`, `check-distributable-boundary.mjs`,
      `check-reference-boundary.mjs`, plus the new `check-port-boundary.mjs` and its negative
      control.
- [x] 7.4 **Write-set audit.** `git diff --name-only main@49f8a88a` and assert every path is under
      `apps/web/src/editor/`, `script/check-port-boundary.mjs`, `BOUNDARIES.md` or the regenerated
      source inventory. Assert **no** `rust/**`, no manifest, no `bun.lock`, no build config, no
      `UPSTREAM.md` / `SBOM.md` / `PATCHES.md`, and that `script/fixtures/type-baseline.json` is
      unmodified. The C0 ∥ C1 concurrency edge rests on this.
- [x] 7.5 Regenerate `SOURCE_INVENTORY.md` / `SOURCE_INVENTORY.json` after the commit that adds files
      under `apps/web/src/editor/` — the generator enumerates files **added** under
      `["apps/web/src", "rust", "apps/web/public"]`, and `upstream-provenance` requires a derived
      inventory to be regenerated against the committed state. **Note explicitly in the change that
      C0 regenerates the same two files on its own branch**; they are generated, so a merge conflict
      there is resolved by re-running the generator, never by hand-merging. This is a real
      intersection with C0's write set and is reported, not assigned away.
- [x] 7.6 Update `BOUNDARIES.md`'s *"No stable storage contract is published by this work"* line
      (`BOUNDARIES.md:141`) to point at where the storage contract now lives, per the
      `browser-persistence-boundary` delta. One forward pointer; the adapter's retirement stays C5's.

## 8. Spec-falsification sweep — manual, and no tool catches it

- [x] 8.1 Grep **all eight** capability specs under `rasen/specs/` for assertions this change's diff
      makes false — `browser-persistence-boundary`, `developer-reproducibility`,
      `editing-parity-fixture`, `host-service-boundary`, `inherited-defect-repair`,
      `next-free-distributable-boundary`, `runtime-asset-delivery`, `upstream-provenance`. **Eight,
      not seven**: `inherited-defect-repair` was added by Track 1's archive and post-dates the Slice
      Plan's count. Include numbered `SHALL` clauses inside requirement **prose**, not only scenario
      bullets — that is where this failure mode hides.
- [x] 8.2 Confirm the two identified falsifications are declared MODIFIED with byte-exact headers and
      full requirement blocks: `browser-persistence-boundary` → *"The persistence boundary is
      explicitly provisional"* (its documentation scenario requires the boundary documentation to
      state that **no stable storage contract is being published**, and `BOUNDARIES.md:141` says
      exactly that — publishing `ProjectStore` with a reference implementation and a conformance
      suite falsifies it **here, at C1**, not at C5); `host-service-boundary` → *"Per-feature
      handling is recorded"* (its completeness scenario enumerates a closed list of server-route and
      remote-network features, which stops being a complete record of the seam once the seam carries
      the port surface).
- [x] 8.3 Confirm these are **not** falsified, and record why, so the sweep is auditable rather than
      assertive: `next-free-distributable-boundary`'s *"Project identity and navigation enter through
      props and callbacks"* (preserved verbatim by 2.2); `host-service-boundary`'s three
      server-endpoint requirements (behaviour unchanged); `editing-parity-fixture` (parity unchanged
      by 7.2); `runtime-asset-delivery` (nothing wired — C4 falsifies it, not this change);
      `upstream-provenance` and `developer-reproducibility` (owned by the concurrent C0 — **do not
      declare deltas on them**, that would collide).
- [x] 8.4 Record the sweep's method and its negative results in the change, not just its hits.

---

## Implementation record (implementer-1, 2026-07-31)

Commits on `feat/s02-port-contract-freeze`: `1864b6aa` (contract), `234b37f3` (inventory),
`c4056c8d` (non-vacuous no-rasterizer conformance case), plus the review-fix commit recorded at the
bottom of this section. Task count is **40**, not the 38 quoted in the dispatch brief.

### Gate readings

| Gate | Pre-change (unmodified tree) | Post-change |
| --- | --- | --- |
| `check-type-baseline.mjs` | `3 diagnostic(s) now, 13 at the pin cf5e79e9 … PASS` | `3 … PASS` (identical) |
| `bun run test:parity` (vite host) | 1 passed (42.4 s) | 1 passed (41.1 s) |
| parity snapshot | archived as comparison baseline | **byte-identical** after JSON normalisation; `diff-parity-snapshots.mjs` reports `0 difference(s): 0 semantic, 0 incidental` |
| `apps/web` production build | success | success |
| `apps/vite-example` production build | success | success |
| `bun test` (whole repo) | 191 pass / 8 fail / 2 errors | **230** pass / **8 fail / 2 errors** — same pre-existing red (this row was recorded as 229 before the third commit; corrected) |
| distributable module graph | `BOUNDARIES.md:45` records 2,844 modules / 550 from `apps/web/src` | 2,844 / 550 — **unchanged**, and **zero** contract modules present |

### Divergences from the plan, reported not absorbed

1. **`FEATURE_HANDLING.md` was written, and it is not in the proposal's declared write set.**
   The `host-service-boundary` MODIFIED delta requires the *per-feature handling record* to cover
   every port role's absence behaviour. That record is `FEATURE_HANDLING.md`; putting the port-role
   table anywhere else would leave the record incomplete in the one place its scenario says a
   reviewer opens. **It is not in C0's write set**, so the concurrency edge is unaffected. Verified
   fork-added (`git cat-file -e cf5e79e9:FEATURE_HANDLING.md` fails), so no `PATCHES.md` row is owed.
2. **The port roles are `Partial` on `EditorHost`.** Required members would have broken both Hosts'
   compilation, and neither Host's source is in the write set. The hard gate moved one level in:
   `resolveEditorHost()` throws naming missing roles, and a session is created only from
   `ResolvedEditorHost`. Recorded as §6 of `DECISIONS.md` so it is not mistaken for softness.
3. **`trackGpuResource` is tracked, not acquisition-mediated.** GPU resources are created inside the
   wasm module, so the session cannot be in their construction path. Stated in `resources.ts` and
   `DECISIONS.md` §3 rather than papered over.

### Falsification sweep — method and results

Method: read all **eight** specs under `rasen/specs/` in full, including numbered `SHALL` clauses
inside requirement *prose* and scenarios nested under unrelated requirements; then checked each
against the actual committed diff (`git diff --name-only 49f8a88a HEAD`) rather than against the
change's intent.

**Falsified — declared MODIFIED (2):**

- `browser-persistence-boundary` → *"The persistence boundary is explicitly provisional"*. Its
  scenario *"Provisional status is stated in documentation"* requires the boundary documentation to
  state that **no stable storage contract is being published**; `BOUNDARIES.md:141` said exactly
  that. Publishing `ProjectStore` with a reference implementation and a conformance suite falsifies
  it **here, at C1**, not at C5. `BOUNDARIES.md` updated; the scenario is renamed in the delta.
- `host-service-boundary` → *"Per-feature handling is recorded"*. Its completeness scenario
  enumerates a closed list of server-route and remote-network features, which stops being a complete
  record of the seam once the seam carries the port surface. `FEATURE_HANDLING.md` extended.

**Not falsified — checked, with the reason (6):**

- `next-free-distributable-boundary` — *"Project identity and navigation enter through props and
  callbacks"* preserved verbatim; *"The Next application still builds and behaves identically"* holds
  (build green, no consumer file touched); the two module-graph requirements hold **positively**, not
  merely by assumption: the bundle is 2,844 modules / 550 from `apps/web/src`, identical to the
  recorded baseline, with zero contract modules in it.
- `editing-parity-fixture` — parity snapshot byte-identical.
- `runtime-asset-delivery` — nothing wired; C4 falsifies it, not this change. Stated precisely: this
  diff does **not** connect `describeGraphics()` to `RendererManager.setDegraded`, so nothing about
  that scenario's reachability *in the running editor* changed at all. (An earlier phrasing here said
  the scenario was "enabled" by the forced declaration; that described C4's work, not this change's,
  and "reachable" would not alter a scenario's truth value in any case.)
- `inherited-defect-repair` — the diff touches no positional-argument call site, no missing export
  and no oracle; type-check clean.
- `upstream-provenance` — *"A derived inventory of modified files is regenerated after the commit
  that changes it"* is **satisfied**, not falsified: `SOURCE_INVENTORY` regenerated post-commit
  (added 5 → 26, modified-inherited unchanged at 17). Not declared MODIFIED — C0 owns it.
- `developer-reproducibility` — the documented install/build/serve/smoke path is untouched, and the
  export inventory is unaffected because the example imports nothing new. Not declared MODIFIED —
  C0 owns it.

### Findings worth carrying

- **`bun run build:web` can report `FULL TURBO` and leave `.content-collections/generated` absent.**
  `turbo.json` declares `outputs: [".next/**"]` only, so a cache hit restores `.next` without the
  generated content-collections directory — which reproduces planning-context §4.2's false FAIL
  (`11 diagnostic(s)`, 8 spurious "S01 regressions") *even when §4.1 is followed exactly*. The fix is
  `npx turbo run build --filter=@opencut/web --force`. §4.1 step 2 should say `--force`.
- **`check-storage-boundary.mjs` scans `script/**` for storage-API literals on non-comment lines**,
  so a new check script that names those APIs in code trips it. `check-port-boundary.mjs` assembles
  them from fragments instead, to avoid editing a file outside this change's write set.

---

## Review-fix pass (implementer-1, 2026-07-31, after review 0B/7Maj/11Min/3Triv)

Commits: `fd88ff60` (the seven Majors + eleven Minors + the GPU reconciliation),
`2b530cb8` (inventory: added 26 -> 28, modified-inherited still 17).
**Five commits total** on `feat/s02-port-contract-freeze`.

All seven Majors fixed; none disputed. Two are worth reading as contract changes rather than repairs:

- **M5** `RuntimeGraphicsQuery.selectedBackend()` is now `GraphicsBackend | null`. The detect branch
  could previously only emit `rasterizer: "gpu"`, so the runtime side was *structurally incapable*
  of the honest answer §3.6 requires on a GPU-less machine. Host-force covers constructibility
  (§3.5); the nullable runtime answer covers truthfulness (§3.6). They are not interchangeable.
- **M6** a failed migration now **fails session creation** and is evicted from the once-per-store
  memo so a later session retries. Recorded in `DECISIONS.md` §4 with the reason the alternative was
  rejected: refusing can be relaxed later without breaking a Host; silently proceeding cannot be
  tightened later without breaking one.

**One fix was reverted after measuring it.** `useEditorPorts()` was added for M2, then removed: it
needs the role register at runtime, so it pulled `editor/ports/**` into the production bundle —
2,848 modules / 554 / **3 contract modules**, destroying this change's central evidence, to add a
hook with no caller. M2 is instead closed by narrowing `useEditorHost()` to `EditorHostBase`, which
makes the unresolved form *invisible* through context at zero runtime cost. Ports reach code through
the session. Graph re-measured after the revert: **2,844 / 550 / 0**, identical to baseline.

`trackGpuResource` now takes the runtime's own `GpuHandleId`, and `dispose()` reconciles the
registry against `RuntimeGpuResourceQuery.liveHandles()`, reporting `untracked` and `leaked`. The
earlier claim that the tracked id was already the teardown key was **false as implemented** and is
corrected in `DECISIONS.md` §3 rather than quietly replaced.

### Final gate readings (all post-fix, on the committed state)

| Gate | Reading |
| --- | --- |
| `check-type-baseline.mjs` | `3 diagnostic(s) now, 13 at the pin cf5e79e9 … PASS` |
| `bun test` | **244 pass / 8 fail / 2 errors**, 252 tests across 33 files — the 8+2 are the measured pre-existing baseline red (191/8/2), unchanged |
| `bun run test:parity` | 1 passed (39.8 s); snapshot **byte-identical** to the archived pre-change baseline |
| module graph | 2,844 total / 550 from `apps/web/src` / **0** contract modules |
| both Host prod builds | success |
| check scripts | asset-manifest, storage-boundary, next-imports, reference-boundary, distributable-boundary, port-boundary, port-boundary --negative-control — all clean |

### Two-directional proofs

- **Role completeness (M1)**: removing `environment: true` from the *real* `PORT_ROLE_REGISTER`
  yields `TS2741: Property 'environment' is missing … but required in type
  'Record<keyof EditorHostPorts, true>'`. An invented role yields `TS2353`. Both directions are also
  pinned permanently in `ports/__tests__/port-roles.compile-guard.ts`.
- **Wasm seam**: stripping the `@ts-expect-error` directives yields `TS2322` for a boolean backend, a
  boolean preview count, an out-of-enumeration backend, a boolean `liveHandles`, and an unkeyed
  `release`.

### Evidence-shape correction adopted

The "wire nothing" claim is now stated from the **complete** `git diff --name-status 49f8a88a HEAD`
(24 added, 6 modified) rather than from a curated path list. The only two modified source files in
the entire diff are `apps/web/src/editor/host/editor-host.ts` and `editor-host-context.tsx`. Note
that `editor-host-context.tsx` is **new to the modified set** since the review, from the M2 fix.

---

## Re-review fix pass (implementer-1, 2026-07-31, after re-review CLEAN + 4 Minors / 3 Trivials)

Commit `513a1892`. **Six commits total** on `feat/s02-port-contract-freeze`.

- **n1** — the reverted `useEditorPorts` hook left instructions behind: an unused
  `ResolvedEditorHostPorts` export documented as *"what `useEditorPorts()` returns"*, and a
  doc-comment stating as current fact that consumers obtain ports through it. The type is deleted
  (zero consumers) and both sites now carry an explicit **"a resolving hook must not be added"** plus
  the measurement that made the revert correct (2,848 / 554 / 3 vs 2,844 / 550 / 0), in
  `editor-host.ts`, `editor-host-context.tsx` and `DECISIONS.md` §6. The single surviving mention of
  the name sits inside the prohibition, naming what is prohibited.
- **n2** — `livePreviewLimit` is reported verbatim; the `Math.max(1, …)` clamp is gone. It was the
  same fabrication M5 removed, one level down and in the **unsafe** direction.
- **n3** — the migration conformance case is now **opt-in** (`exerciseMigration`), because
  `migrate()` is a real destructive transformation against whatever store it is pointed at; it
  reports `skipped` when off, **rejects `failed`**, and additionally asserts idempotence. Both
  directions tested: a working migration passes, a permanently-failing one fails the suite.
- **n4** — `no-direct-wasm-import` is re-described as a **fence around** the reconciliation rather
  than as the GPU analogue of the acquisition checks. It bans an import, not an allocation, and the
  three real allocators sit outside its scope until C4/C6. Recorded in the rule's own comment.
- **n5** — added the missing test: both awaiters of a shared failing migration reject, and the memo
  is evicted so a later session retries. The existing test covered only the sequential route.
- **n6** — the original gate table's `229 pass` corrected to **230**.
- **n7** — `resolveSpecifier` anchors each area with `(\/|$)` so a directory-index specifier such as
  `@/core` is caught; added as a control fixture.

### Gate readings — measured on a FRESH build from committed HEAD

Both `.next` and `apps/vite-example/dist` were **deleted** before rebuilding, after the re-review
found the previous artifacts predated the commit they were being read against.

| Gate | Reading |
| --- | --- |
| `check-type-baseline.mjs` | `3 diagnostic(s) now, 13 at the pin cf5e79e9 … PASS` |
| `bun test` | **248 pass / 8 fail / 2 errors**, 256 tests / 33 files — the 8+2 remain the measured pre-existing baseline red |
| module graph (fresh) | **2,844 total / 550 from `apps/web/src` / 0 contract modules** |
| emitted vite chunks referencing a contract module | **0** |
| `.next` files referencing a contract module | **0** |
| `check-distributable-boundary` composition | `550 / 8 / 2282 / 4` — identical to `BOUNDARIES.md:45` |
| both Host prod builds | success |

**`check-asset-manifest` exits 2 with no preview server running** — confirmed directly, and adopted
as the honest reading. Earlier "clean" readings in this change's record were taken while a
`vite preview` happened to be up from a parity run; that is a measurement artefact, not a result.
