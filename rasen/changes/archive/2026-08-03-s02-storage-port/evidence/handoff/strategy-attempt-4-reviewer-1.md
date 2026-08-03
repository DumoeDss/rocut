# S02 C5 strategy attempt 4 — reviewer 1 handoff

## Reason for handoff

The mandatory context-compaction trigger fired before independent verification was complete. This is an incomplete, report-only reviewer handoff: no verdict has been issued and `evidence/review-report.md` has not been written.

## Scope and constraints

- Review worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`
- Frozen base commit: `0ef35459f685d5d41a25d0ef959aff691b7519cd`
- Expected frozen base tree: `286272307b05d23826ffa7223a76695365194dba`
- Canonical final artifact (for the successor only after completing the review): `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\s02-storage-port\evidence\review-report.md`
- Do not edit product code, tests, task artifacts, run state, or prior evidence. Do not commit.
- Review is governed by the `rasen-review` skill in dispatched/report-only mode.

## Completed

### Instructions and workflow

Read completely:

- `.codex/skills/rasen-review/SKILL.md`
- `.codex/skills/rasen-review/checklist.md`
- `.codex/skills/rasen-review/greptile-triage.md`
- Primary-repository `AGENTS.md` and `CLAUDE.md`
- Review-worktree root `AGENTS.md`
- `apps/web/src/services/storage/migrations/AGENTS.md`

The migration-area instruction is additive-only. No PR/Greptile review is applicable.

### Change and attempt artifacts

Read completely:

- `proposal.md`, `design.md`, `tasks.md`
- `specs/browser-persistence-boundary/spec.md`
- `specs/host-port-contract/spec.md`
- Attempt 4 topology audit, design, implementation evidence, and implementation handoff
- Attempt 3 design, implementation, review, verification evidence, and reviewer/implementer/verifier handoffs
- Attempt 4 fixer handoffs 1, 2, 3, 6, 8, and 11

### Product and test audit

Read completely:

- `apps/web/src/services/storage/browser-project-store-topology.ts`
- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/browser-project-store-media-ownership.ts`
- `apps/web/src/services/storage/browser-project-store-library-clear-bindings.ts`
- `apps/web/src/services/storage/browser-project-store-cascade.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-manager.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts`
- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `apps/web/src/services/storage/browser-project-store-internals.ts`
- `apps/web/src/services/storage/browser-project-store-control.ts`
- `apps/web/src/services/storage/browser-storage-mechanisms.ts`
- Four topology unit files under `apps/web/src/services/storage/__tests__/`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`
- `apps/vite-example/playwright.c5-storage.config.ts`

`git branch --show-current` returned `feat/s02-storage-port`. `git status --short` and `git ls-files --others --exclude-standard` were inspected. Much of the attempt-4 implementation is untracked, so the successor must continue to inspect the actual files rather than rely on `git diff HEAD`.

No validation commands have been run yet. A PowerShell parse error made the first tree query invalid after the correct HEAD was printed; rerun the quoted tree query below.

## Concrete review leads requiring closure

### Lead A — retained library claims are omitted from media first-access authorization

Likely severity if reproduced/confirmed: **Major**, retaining accepted finding `C5-S4-M2` rather than closing it.

In `browser-project-store-media-ownership.ts`, media registration and refresh authorize current/known media claims, but helper `authorizeMediaClaim` supplies `knownLibraries: []`. `registerMediaOwner` performs an initial authorization with `knownMedia: []`, reads strict media ownership, and reauthorizes with `state.knownMedia`; neither step includes current/retained library claims. `authorizeKnownMediaClaims` has the same omission.

`readKnownLibraryPhysicalClaims` exists in `browser-project-store-library-clear-bindings.ts` and is used by cascade and migration authorization, but not by ordinary media first access.

Potential consequence: after a library configuration changes, an old library claim can remain retained for `(oldLDB, oldLS)` while the current library uses another database. A current media binding can derive `MDB(project) = oldLDB` and be certified before attachment I/O. If the media store is `oldLS`, an attachment row can collide with/overwrite a retained library row; even with a distinct store, it creates an unapproved whole-database media ownership overlap. Cascade cleanup appears to reject the overlap later, but ordinary media access has already crossed the boundary. This conflicts with the attempt-4 design requirement to authorize media access against every known current/retained library claim before descriptor, metadata, IndexedDB, or OPFS I/O.

The topology primitive supports `knownLibraries`, but the media-access wiring and existing media topology tests do not appear to exercise retained library claims. Confirm with a focused reproduction and precise line references. If confirmed, recommended fix direction is to load strict current/retained library claims and include them in both media first-access and refresh authorization before any media I/O. Add negative coverage for an old retained LDB collision (same exact pair and same DB/different store) and a safe nonalias control.

### Lead B — migration attachment discovery performs IndexedDB/OPFS access before topology authorization

Likely severity if reproduced/confirmed: **Major**, relevant to accepted finding `C5-S4-M1` and the fail-closed ordering contract.

In `runBrowserProjectMigration` in `browser-project-store-migration.ts`, the planning loop calls `stageLegacyAttachments(...)` before `authorizeMigrationCleanup(...)`. `stageLegacyAttachments` invokes `idbGetAll` against the derived media database/store and then reads OPFS attachments. Only after candidate transformation/staging does the function read the cleanup journal and request the full topology permit.

This is not necessarily read-only in the real browser. `openDatabaseStores` in `browser-storage-mechanisms.ts`, used by `idbGetAll`, opens/creates the database and creates a missing object store through a version upgrade. An unsafe current media target that aliases PDB, LDB, SP, SA, or a migration stage can therefore access and potentially schema-mutate a protected live database before the topology refusal. The migration topology unit mocks `idbGetAll` as a pure call and its mutation-call assertion excludes reads, so it does not prove the real IndexedDB ordering.

Confirm with precise line references and, preferably, a real Chromium scenario containing a legacy project whose derived media DB aliases a protected DB. Assert refusal occurs without database/store creation or version/schema mutation. If confirmed, recommended fix direction is to split discovery: derive all current media physical claims and obtain the full permit before `stageLegacyAttachments` performs any IndexedDB/OPFS access; then execute only permit-authorized targets.

## Preliminary closure analysis (not a verdict)

- `C5-S4-B1`: whole-media-database deletion looks substantially protected. The topology permit includes PDB, current LDB, SP/SA, known retained libraries, and known media. Current remove/clear authorizes before logical commit; historical cleanup authorizes the full record before physical loops; cleanup executes frozen permit targets. Mixed safe/unsafe unit cases appear to reject without partial mutation. This still requires command evidence and a bypass sweep.
- `C5-S4-M1`: migration cleanup/retry itself looks substantially protected. It loads strict known media/library claims, checks the whole cleanup batch, and authorizes before delete or journal shrink. Lead B may prevent full closure because pre-permit discovery crosses the same physical boundary.
- `C5-S4-M2`: topology rules reject media/library database aliasing, but Lead A indicates ordinary media-access wiring may omit retained library state and leave this finding open.
- Historical topology conflicts appear to retain the journal and write a stable nonretryable `unavailable` diagnostic; current conflicts appear to fail before logical commit. Verify consumers and exact-three contract before concluding.

## Remaining work and commands

Run from `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5` unless a command requires another working directory.

1. Verify frozen identity (quote the tree expression in PowerShell):

   ```powershell
   git rev-parse HEAD
   git rev-parse "HEAD^{tree}"
   git status --short
   ```

2. Complete the enum/union consumer sweep for topology conflict phases, reason/status values, migration/cascade diagnostics, and exact-three result shapes. Use narrow `rg` queries so output does not truncate.

3. Reproduce or decisively disprove Leads A and B without modifying repository files. Inline Bun commands are acceptable. Prefer real Chromium evidence for Lead B because the key issue is IndexedDB open/upgrade behavior.

4. Run the four topology units in four separate Bun processes:

   ```powershell
   bun test apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts
   bun test apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts
   bun test apps/web/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts
   bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
   ```

5. Run focused and full C5 Chromium suites:

   ```powershell
   bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
   bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
   ```

   Keep server/process cleanup task-scoped. Do not touch the user's normal Chrome session.

6. Run targeted TypeScript and static/boundary checks. First inspect package scripts and the attempt-4 evidence for the narrowest existing targeted TS command; a likely baseline is:

   ```powershell
   bun x tsc --noEmit -p apps/vite-example/tsconfig.json
   node script/check-type-baseline.mjs
   node script/check-port-boundary.mjs
   node script/check-session-state-boundary.mjs
   node script/check-storage-boundary.mjs
   node script/check-host-composition.mjs
   git diff --check
   ```

   Inspect and run the relevant C5 negative/static tests (including `script/__tests__/c5-storage-boundary-red.test.mjs`) if not already exercised transitively. Run `rasen validate s02-storage-port --project rocut --strict` if the local CLI is available, as cited by implementation evidence.

7. Sweep every physical deletion and migration-stage/legacy-cleanup call site, including untracked files, to prove there is no path bypassing the permit. Confirm current refusal is before logical commit; historical refusal retains the journal and never partially mutates a mixed batch; same-ID reuse behavior is preserved.

8. Only after all of the above, write the canonical `evidence/review-report.md` with a clear verdict and evidence-backed closure/retention of `C5-S4-B1`, `C5-S4-M1`, and `C5-S4-M2`. Do not edit this handoff or prior evidence to substitute for the report.

## Next action

Successor reviewer should begin by verifying the quoted frozen tree, then close Leads A and B before spending time on broad validation. The most important unanswered question is whether the media-access and migration preflight omissions are real protected-state side effects; those determine whether attempt 4 can pass.
