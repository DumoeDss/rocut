# Implementer handoff — s05-second-host (P2) → P3 (conformance-for-third-parties + pack-and-install)

Written at retirement (review loop closed CLEAN, two rounds). Dual-seed this
with P3's own change artifacts. Cross-change-transferable knowledge only;
P2-internal narrative lives in the child's `evidence/implementation-report.md`.

## 1. Conventions that held, and what changed

**Held from P1:** one `feat(<change>):` commit per tasks.md group, explicit
pathspecs only, the `.rasen/` staging guard (`RASEN_COUNT=$(git diff --cached
--name-only | grep -c '^\.rasen/')` — grep -c exits 1 on zero, so capture it
in a variable), LF-in-worktree (the Write tool flips CRLF on this machine:
after every write, `tr -d '\r'` then verify `tr -dc '\r' < f | wc -c` = 0),
Co-Authored-By trailer, local commits only — the portfolio delivers once at
the parent, after all children. Evidence naming: `evidence/logs/group-<n>-*.log`,
`screenshots/group-<n>-*.png`, per-group sections appended to
`evidence/implementation-report.md`, one review-round section per review round.

**Changed / new this child:**

- **Census figures must carry method + measurement point inline.** The
  reviewer now expects any "N tracked files" figure to name how and where it
  was counted: `git ls-tree -r <commit> --name-only | wc -l` at a *named*
  commit. A figure captured mid-change goes stale by its own landing commit —
  measure at (or via `git write-tree` for) the commit the reader will read it
  from, and say so in the sentence itself.
- **REAL_EXIT_CODE discipline is now load-bearing for the reviewer.** Every
  headline evidence log self-logs `REAL_EXIT_CODE:$?`; sweep loops emit
  `EXIT[<name>]:<code>` per checker. Background task exit codes lie (exit 0
  on real crashes) — the self-logged line is the proof, and the reviewer
  reproduces from it.
- **The review loop's fix-batch flow that worked:** the whole batch routes to
  the implementer at once; when history surgery is in the batch it goes FIRST
  (fix commits land on clean history); every finding gets a disposition in
  the report's review-round section (fixed / accepted-known + justification);
  accepted-known claims get *reproduced by the reviewer* — never assert a
  compiler/tool behavior you haven't run (see the F8 lesson in §4).
- **The static checkers now judge three consumers.** Consumer scan roots
  derive from `boundary.json`'s `consumers` (P2's G2 generalization); a new
  consumer declares itself there and most checkers' ls-files-based sets
  follow automatically. `check-host-composition.mjs` expects a HOSTS array
  entry `{path, durableStore, identityKey}` per Host — a fourth Host adds one
  entry plus fixtures, not a rewrite.

## 2. Tooling traps P3 will hit

- **Typecheck: run the app-local compiler, never bare `npx tsc` from the
  parent repo.** `bun run --cwd apps/electron-host typecheck` — parent-repo
  tsc resolution produces phantom duplicate `lib.dom.d.ts` sets (P1's trap,
  still true). Same for any new host: its own tsconfig, its own script.
- **tsc writes CRLF in its output on this machine.** If you redirect tsc
  output into an evidence log, the log carries CRLF lines — the LF audit
  (`git ls-files --eol` over the change's path set) will catch it at ship
  time. Normalize when the log is the deliverable, or capture only the exit
  line yourself and let the tool output live where it lives.
- **`/tmp` is three different directories.** bash `/tmp` ≠ python `/tmp` ≠
  node's `/tmp` (node resolves to the Windows temp dir). A sweep script file
  written to `/tmp` by one context vanished entirely when executed by
  another. Background sweeps run inline with **repo-local** log paths.
- **Don't background inside a backgrounded command.** An `&` inside a
  `run_in_background` command detaches when the outer shell exits; the
  REAL_EXIT_CODE echo may not survive. One level of backgrounding only;
  `until grep -q <marker>` background waits for completion signals.
- **vite preview binds `[::1]` only by default**; anything fetching
  `127.0.0.1:<port>` (e.g. `check-asset-manifest.mjs`) needs
  `preview --host 127.0.0.1`.
- **Boot/oracle scripts write screenshots to FIXED paths** — a re-run
  overwrites an earlier group's screenshot. Restore from HEAD rather than
  committing the overwrite, and restore with `git show HEAD:<path> > <path>`
  — `git checkout --` can silently no-op via the stat cache.
- **Playwright `_electron.launch` under `DEBUG=pw:channel` dumps the whole
  inherited process env** into the transcript (§5). `executablePath` must be
  the electron binary (`require("electron")` outside an Electron process),
  not the package's index.js — a `.js` path dies in 300 ms with only
  "Process failed to launch!".
- **PowerShell from bash mangles `$_`** — use the PowerShell tool directly
  for process inspection; node `--check` covers `.cjs` syntax after
  main-process edits.

## 3. What P3 should know about P2's surfaces

- **The third-Host seam, concretely.** `apps/vite-example/tests/parity/host-profile.ts`
  holds a per-host profile union (VITE/NEXT/ELECTRON) with entries and
  markers; `driver.ts`'s `importFixtures` carries a per-host branch;
  `snapshot.ts` dispatches a **host-scoped persisted reader** per profile.
  P3's scratch-project adapter (a non-IndexedDB store) should enter through
  exactly this seam — add a profile + a host-scoped reader; do not touch the
  browser readers' bodies (the vite+next regression control is the proof
  that you didn't). The page-acquisition seam lives in `parity.pw.ts`.
- **`runPortConformance` is store-mechanism-agnostic on its portable
  profile**, and its opaque-payload case is the provider-private round-trip
  proof. `FilesystemProjectStore` ran it from a conformance test inside the
  host (`store/__tests__/filesystem-store-conformance.test.ts`) — P3's
  adapter does the same; the suite never learns the storage mechanism.
- **`runStorageMigrations` is IndexedDB-hardwired**
  (`packages/editor-classic/src/services/storage/migrations/runner.ts:32-36`
  constructs `new IndexedDBAdapter(...)` directly). P3's adapter must
  replicate the per-record walk over the runner's published `migrations` +
  `CURRENT_PROJECT_VERSION` — in memory, all-or-nothing, fail-closed (a
  refusing transform is a failure, not a `break`), chain must reach current.
  The spec letter now says "the published migration artifacts under the
  store's own sequencing". The structural fix is a package-side runner-core
  export (a legal, attributed export-map addition) — worth proposing if P3
  grows a third non-browser store.
- **The runtime-asset allowlist lives at
  `apps/vite-example/build/editor-assets.ts`** — a consumer-owned build
  artifact that other hosts import cross-app (`electron-host/vite.config.ts`
  imports `../vite-example/build/*`; the consumer↔consumer edge is excluded
  from acyclic-direction by design and recorded in the checker audit). P3's
  tarball/pack harness hits this placement: assets and workers are composed
  from BASE_URL-relative specifiers through that allowlist — root-absolute
  URL literals trip `check-runtime-asset-boundary.mjs`'s root-css-url rule
  (whose `url(` pattern also matches `new URL(` — that is the rule working,
  not a false positive).
- **CSP on a custom origin:** the C6 disposal oracle's object-URL
  terminality probe *fetches* the `blob:` URL it creates, so any
  custom-origin host running C6 needs `connect-src 'self' blob:` — an
  attributed relaxation per host (design E7), policy string byte-identical
  in every home (main-process header, index.html meta, evidence-page meta),
  each naming the probe. And **every scheme response carries the header**,
  404/403 included (round-1 F6).
- **The C6 cycle-1 timer race is deterministic on desktop** (10/10 gated
  attempts, cycle 1 only, exactly 1 retained handle, `first disposal: `
  prefix on the durable-reopen leg) — non-blocking per the recorded
  distribution; the oracle gate pins the exact suffix regex, so transcribe
  observed failure strings, don't approximate them.
- **The four S03+S04 frozen surfaces** (transaction barrel, engine, ports
  barrel, Surface embedding types) were byte-identical at P2's base via
  `git show <base>:<path> | cmp`. P3 inherits the same freeze: pressure to
  change one is a `failed` finding returned to the contract — escalate,
  never patch.

## 4. Dead ends and eliminated hypotheses

- **Direct delegation to `runStorageMigrations`:** impossible without
  touching a frozen surface (IndexedDB-hardwired). Transform-level
  delegation is the settled mechanism; don't re-litigate it, restate any
  spec letter that says "runner" to "published migration artifacts".
- **Root-absolute `new URL("/...", origin)` in harness code:** trips the
  asset-boundary rule *legitimately*; fix the source to BASE_URL-relative
  composition, never weaken the rule.
- **`constructorName` as a store-identity gate:** production minifiers
  rewrite it (observed `Tet`); the contract marks it diagnostic-only. Gate
  on `instanceof`; record the name as a diagnostic.
- **Transcribing a gate's bad-disjunction verbatim as the positive form:**
  produces a subtly wrong predicate that looks green. Write positive forms
  from semantics (the dwell-completeness inversion error cost two oracle
  runs).
- **"A single `as` cast doesn't compile for disjoint literal unions":**
  FALSE under both this repo's TS 5.9.3 and 6.0.3 — the round-1 report
  claimed TS2352 where there is none, and the reviewer reproduced the
  compile clean. The `as unknown as` crossing is never compile-required
  here. The meta-lesson: reproduce compiler claims before writing them into
  evidence.
- **Named backup branches during a credential rewrite:** never — a named ref
  keeps the credential blob reachable and pushable. Reflog-only
  recoverability, with the safety sha recorded in prose.
- **Host-label inference:** the durable-reopen proof input's host label
  reads `vite` on the electron Host (pathname inference) — diagnostic only;
  identity is the instanceof predicate.

## 5. Credential-rewrite outcome (the rule, not the values)

A redaction commit never redacts history — if credential bytes reach a
commit, only a history rewrite or rotation remediate, and the rewrite must
happen before later children stack commits (cost grows per child). The
capture-side rule that prevents the class: Electron/Playwright evidence
captures pass an **explicit minimal `env`** to `_electron.launch`, never the
inherited one. This child's rewrite collapsed the capture commit and its
redaction into one natively-clean commit (`squash` + `rebase --onto`,
content-identical, zero conflicts), verified four ways — final tree
diff-empty, credential blob unreachable from every ref, commit count
reconciled, boundary checker green — with the procedure, safety sha, and
results in the child's `evidence/rewrite-record.md`. The branch was never
pushed.

## Remaining

(empty — P2 retired between children; nothing is in flight)
