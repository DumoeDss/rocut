# Direction corrections — S02 Plan and Spec

> **Authority note.** These corrections were applied to
> `elftia/rasen/work/opencut-agent-editor-sdk/slices/02-session-runtime-host-ports/plan.md` on
> 2026-07-31 and then **silently wiped** when a concurrently-running session's git operation restored
> that tracked file to its committed state. This copy lives in `rocut`'s gitignored planning tree,
> which that session never touches, and is therefore the **durable** record.
>
> **When plan.md and this file disagree, THIS FILE IS CORRECT.** Every entry below was measured or
> verified by the LEAD, not inferred. Each names the exact stale text so you can recognise it when you
> hit it.

## C-1 — The baseline. plan.md §1, §3.2, §9.1 D7, §10

**Stale text:** *"Starting state is **not** `main`. `main` is clean at the pin `cf5e79e9`."* and
*"the starting baseline is named and Track 1 is reconciled — **outstanding, D7**"*.

**Correct:** the baseline is **`main@49f8a88a`**, tree `97097f0a2e9f459af53e311310c0166c75acbfc5`.
`main` left the pin on 2026-07-30 via a `--no-ff` merge that landed S01's three commits and Track 1's
two together. **`49f8a88a`'s tree is byte-identical to Track 1's tip `620f1c4f`** (verified with
`git rev-parse <rev>^{tree}` on both), so **D7 is closed by that merge itself**, not by a separate
reconciliation step. The pin stays recoverable via origin history, the SHA, and `_others/rocut-wt-s01`.

Consequence worth keeping: `_others/rocut-wt-s02` has the baseline tree **plus** `node_modules` and a
built `.next`, so it is a **free read-only measurement surface**. Use it instead of building something
just to measure it.

## C-2 — The `C0 ∥ C1` write-set claim. plan.md §5

**Stale text:** *"Write-set intersection: **Empty.** … No file appears in both."*

**Correct:** the intersection is **`{SOURCE_INVENTORY.md, SOURCE_INVENTORY.json}`**. Both are
git-tracked, both children add files under the areas the inventory covers, and `upstream-provenance`
requires the derived inventory to be regenerated after the commit that changes the compared set.

**The concurrency edge survives, on corrected evidence.** `script/generate-source-inventory.mjs`
hashes the **pinned** content (`git ls-tree cf5e79e9`), so the `areas` / `totals` / `files` sections
are byte-identical on both branches. The only working-tree-dependent field is
`workingTreeDriftAgainstPin.added`, taken from `git diff --name-status`. Regenerating after a merge
therefore yields exactly the **union** of the two `added` lists, losing nothing.

**Standing portfolio rule:** a `SOURCE_INVENTORY` conflict is resolved by re-running
`node script/generate-source-inventory.mjs`, **never** by hand-merging. Expect it for nearly every
later child, since almost all of them add files under `apps/web/src`.

Also corrected in the same table: C0's touch set omitted three things — **`apps/web/package.json`**
(a *second* `opencut-wasm` declaration; the Plan named only the root manifest), **`PATCHES.md`**, and
`script/generate-sbom.mjs`'s **defect probe** (the Plan says "fixtures", but the actual breakage is
the generator's `exit(1)` condition). C1 owes **no** `PATCHES.md` row — that file logs modifications
to files inherited *at the pin*, and `editor-host.ts` is a file the fork *added*.

## C-3 — The `C0b ∥ C2` rationale. plan.md §5

**Stale text:** *"C0b adds exported symbols and C2's refactor moves type counts, so **both would edit
`script/fixtures/type-baseline.json`**."*

**Correct: that reason is false**, though the scheduling conclusion stands. The fixture is a **pin
snapshot** — `--regenerate` reconstructs `cf5e79e9` through `git archive` into a temp tree and runs
`tsc` **there** — so it does not track HEAD and neither child edits it. Reductions are reported
informationally and never fail; only a per-diagnostic count *above* the pin's fails.

The serialization survives on a stronger basis: C2 depends on C1, C0b now depends on C1, and C0b
authors the wasm side of an interface C3 consumes on the same seam C2 moves (`use-editor.ts` / the
session factory). The type baseline was never the real constraint — it was a proxy for it.

## C-4 — The capability-spec count. plan.md §7, and everywhere "seven" appears

**Stale text:** *"grep all seven existing capability specs"*.

**Correct: there are EIGHT.** `rasen/specs/inherited-defect-repair/` was created by Track 1's archive
and post-dates the Plan. Verified by directory listing: `browser-persistence-boundary`,
`developer-reproducibility`, `editing-parity-fixture`, `host-service-boundary`,
**`inherited-defect-repair`**, `next-free-distributable-boundary`, `runtime-asset-delivery`,
`upstream-provenance`.

Two refinements to the sweep itself:

- **`browser-persistence-boundary` is falsified at C1 as well as at C5.** The Plan predicted C5 only.
  C1 publishes `ProjectStore` with a working reference implementation and a conformance suite, which
  falsifies `BOUNDARIES.md:141`'s *"No stable storage contract is published by this work."* C1 declares
  a narrow amendment (the provisional label moves onto the *adapter implementation*); the adapter's
  retirement stays entirely C5's, which modifies the same spec again. Serial, so no conflict.
- **Read scenarios nested under unrelated requirements, not just requirement headers.** C0's sweep
  found a live instance: `upstream-provenance`'s requirement *"Repairing a donor code defect does not
  repair a recorded metadata defect"* carries a scenario asserting that *every* recorded metadata
  defect is still detected as present — which C0 falsifies by repairing D-5. It sits under a
  requirement about **code** defects, so a keyword grep for "wasm" or "licence" would never find it.

## C-5 — C4's graphics paragraph. plan.md §4, C4 entry. **Read this before dispatching C4.**

**Stale text:** *"E0 never observed a WebGL **context** on the editor's own canvas in **any**
configuration, including on an RTX 3060 — `getContext`, `webglcontext` and `contextlost` appear in no
result file, and every WebGL figure there came from a throwaway host *capability* probe."*

**Correct: spec §3.5 fact 2 explicitly replaced that on 2026-07-31.** A direct four-configuration
backend measurement (`results/run12|13|14/q6b-gpu-backend.json`, driver `scripts/run-gpu-backend.mjs`)
established that the editor **initialises a real GPU context in every configuration tested**, and that
the backend **flips with adapter availability, both branches being reachable on one machine**. The
observation is tied to this source: `requestAdapter` is called from inside the wasm, `requestDevice`
fulfils with the label `"gpu-device"` (the literal at `crates/gpu/src/context.rs:282`), and the WebGL
branch shows `try_gl_fallback()`'s exact 1×1-detached-canvas signature.

What C4 still owes, and must not overclaim:

- **Two things remain genuinely unmeasured** — whether a *timeline view* renders under software
  rasterization, and whether the editor survives a **no-rasterizer** host at all. `run11` reached only
  the project-picker screen.
- **Two neighbouring questions are already answered; do not re-measure them** — packaged Elftia *does*
  reach the timeline view on default hardware (`run4`/`run9`), and the editor *does* acquire a GPU
  context in all four configurations.
- Acquiring a context is **not** rendering a timeline. C4 may not cite E0 as evidence that software
  rendering suffices for the editor proper.
- **`RendererManager` already has `isDegraded`/`setDegraded`, and `editor-root.tsx` already renders
  the degraded banner.** The state exists; what has never existed is a way for a Host to *cause* it —
  which is exactly why S01 could never observe it. **C4 drives the existing state; it must not add a
  parallel one.**

## C-6 — Disk and the fresh-worktree recipe. plan.md §3.5, §5 residual risk, §8

**Stale text:** *"`E:` had **3.5 GB free** on 2026-07-30"*.

**Correct:** re-measured 2026-07-31 at **10.5 GB free** before cohort-1, **6.6 GB** after both
worktrees installed (~1.85 GB each). Rust `target/` must be directed to `C:` via `CARGO_TARGET_DIR`.

The full fresh-worktree bring-up order, and the false-FAIL trap that makes step order load-bearing,
are in **`planning-context.md` §4.1 / §4.2**. Read them before running anything in a new worktree.

## C-7 — C0b and C2 scheduling adjudication. Supersedes C-3's serial conclusion

**C-3's correction of the type-baseline rationale remains valid, but its fallback scheduling
conclusion is now superseded.** A LEAD adjudication on 2026-07-31 established a positive independence
proof for **`C0b ∥ C2`**, subject to explicit gates.

- C1 owns and freezes `RuntimeGraphicsQuery`, `RuntimeGpuResourceQuery`, and the
  `createEditorSession` injection points. Neither C0b nor C2 authors the shared contract.
- C0b implements additive Rust/WASM runtime providers. C2 removes the JavaScript singleton and
  rewrites commands/managers around the C1-compatible session factory and placeholders.
- Both children feed C3. C2 does not consume C0b's exports, and C0b does not consume C2's factory.
  A shared downstream join is not a dependency edge between the two producers.
- Their product-source write sets are disjoint. `SOURCE_INVENTORY.{md,json}` remains deterministic
  derived state and is regenerated after integration rather than hand-merged.

**Hard conditions:** both children start from one review-clean C0+C1 integration baseline; C0b's
brief includes verbatim the obligation *"export a live-handle enumeration satisfying
RuntimeGpuResourceQuery, and make selectedBackend() able to return null"*; C2 must neither redefine
C1's contracts nor wire C0b before C3; and C3 starts only after a combined integration gate over both
children passes. If either child crosses those touch/scope guards, stop the cohort and serialize.

## C-8 — PATCHES.md is a shared provenance record, not a product-source dependency

The C2 specification sweep found that the archived `upstream-provenance` requirement applies to
every behaviorally modified inherited file. C2 therefore cannot remain review-clean while omitting
`PATCHES.md`, even though its initial proposal listed only TypeScript/React source, the singleton
gate and inventories.

- C0b and C2 still have disjoint **product-source** write sets and neither consumes the other.
- `PATCHES.md` is now a second shared record file. Each child records only its own exact inherited
  file rows.
- Integration must preserve the semantic union of both row sets and rerun the provenance checks.
  Unlike `SOURCE_INVENTORY.{md,json}`, `PATCHES.md` is not regenerated and must not be resolved by
  taking either side wholesale.
- This documentation overlap does not invalidate the parallel proof. Dropping either child's rows
  would invalidate the combined result.
