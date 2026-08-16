# Final pre-ship review — sdk-export-capability (2026-08-17)

Reviewer: independent fork (author≠verifier — none of the reviewed code is
mine; implementers were sonnet agents plus the LEAD). Scope: the complete
diff against `661d7ac8`, feature-frozen tree. Prior pass:
`review-ab-pass1.md` (B-1/M-1 fixed; m-1/m-3/m-4 dispositioned report-only).

## Verdict: **FIX-FIRST** — one Blocker (one-line source fix + rebuild + one
re-run + evidence corrections), one Major (evidence backing), rest minor.

---

## Blocker 1 — the content-digest guard is INERT in the built app, and the
project name is silently lost

`electron/main.cjs` destructures `projectContentDigest` from
`dist-main/main-export-ipc.cjs`, but `main-export-ipc.ts` re-exports only
`{ EXPORT_IPC_OPERATIONS, EXPORT_IPC_CHANNEL_PREFIX, resolveFfmpegPath }`
(`main-export-ipc.ts:48`), and neither `main.cjs` (plain JS, not typechecked)
nor the build catches it. Verified live against the current bundle:

```
node -e "console.log(typeof require('./apps/electron-host/dist-main/main-export-ipc.cjs').projectContentDigest)"
→ undefined
```

Failure scenario (observed, not hypothetical): every `getProjectMeta` call
throws `projectContentDigest is not a function`, the `.catch(() => null)`
swallows it, `meta` becomes null, so (a) `startJob` records
`projectContentGuard: null` — the beginExport guard check short-circuits on
`record.projectContentGuard !== null` and NEVER compares digests; (b) the
output loses the project name — smoking gun in the run logs: pre-fix legs
named outputs `D2-800-9b99f98a.mp4`; the post-fix recovery/GPU legs name them
`export-2101ee0d.mp4` / `export-aede7e53.mp4` (the no-meta default).

**Consequence for the claims:** the post-fix recovery PASS
(`d2-lifecycle-proofs.md`) and the PR draft's finding #3 ("FIXED IN THIS PR …
kill → resume → completed in 723.8s") attribute the pass to the digest guard.
In truth the pass came from the guard being silently absent (permissive
null). The stale-timeline semantic is currently NOT exercised at app level at
all — the harness-side `waitForOpenSaveSettled` quiet-window, not the digest,
is what avoids the thumbnail race in the shipped app.

**Fix (exact):**
1. `main-export-ipc.ts:48` → `export { EXPORT_IPC_OPERATIONS, EXPORT_IPC_CHANNEL_PREFIX, resolveFfmpegPath, projectContentDigest };`
2. Rebuild dist-main (`cd apps/electron-host && bun run build`).
3. Re-run ONE recovery leg (`--phase recovery --recovery-runs 1 --clips 100
   --gpu real --append`) and assert in its output that the record's
   `projectContentGuard` is non-null (the current run logs don't prove that —
   add it to the harness's raw-size gate line if cheap) and that the output
   name carries the project name again (`D2-100-*.mp4`, not `export-*.mp4`).
4. Correct `d2-lifecycle-proofs.md` and `pr-body-draft.md` finding #3 to
   describe both layers honestly: harness quiet-window (worked before the
   fix) + digest guard (engages after this fix; the earlier post-fix pass
   rode permissiveness).

The digest recipe itself is sound on the key-order question I was asked to
reason about: both sides digest objects deserialized from the same on-disk
v8 bytes through the same `NodeFsStoreBridge` (main directly, producer via
IPC structured-clone of main's identical object); both v8-deserialize and
structured clone preserve string-keyed property insertion order, so
`JSON.stringify` is deterministic across the two readers. Date normalization
via the `{__isoDate__}` wrapper is symmetric; undefined-valued keys drop
identically on both sides. No path crosses the bridge.

## Major 1 — group-b evidence cites nine log files that exist nowhere on the tree

`group-b-export.md` references `groupb-mut-a-red.log`, `groupb-mut-a-green.log`,
`groupb-mut-b-red.log`, `groupb-mut-b-green.log`, `groupb-jobmgr-run3.log`,
`groupb-typecheck-early2.log`, `groupb-rerun-isolated.log`,
`groupb-rerun-migration.log`, `groupb-child-*` — none exist (checked repo
root, evidence dir, whole tree). The mutation red/green pairs are the change's
own load-bearing verification standard ("every fix has mutation
verification"), and this repo's history has already had a Blocker-class
incident over evidence describing nonexistent command outputs. The .md
records plausible, specific numbers — the risk is unbacked claims, not
fabrication-by-pattern.

**Fix:** either re-run the two mutation pairs with logs committed into
`evidence/` (commands are recorded in the .md and re-runnable), or annotate
the section stating the logs were session-local and did not survive, with the
exact re-run commands. Re-running is strongly preferred (≤10 min).

## Minors

1. **Group A's referenced logs live at the repo root untracked**
   (`.groupa-*.log`, incl. its three mutation pairs) — they exist but will
   not be committed, while `group-a-ports.md` cites them by bare filename.
   Copy the load-bearing ones (mutation red/green, final full-test) into
   `evidence/` or note the convention.
2. **~40 untracked scratch logs at the repo root** (`.g-*`, `.groupa-*`,
   `.parity-*`, `.` build/test logs, `.tc-digest.log`, …) — must not enter
   the PR; commit with explicit pathspecs (`apps/`, `packages/`, `docs/`,
   `rasen/changes/sdk-export-capability/`) and assert `git status --short |
   grep -c '^??'` drops to the intended set afterwards.
3. **Stale field name in a doc comment**: `export-lifecycle-proof.mjs:302`
   still narrates `projectUpdatedAtGuard` (the retired field). One-line
   comment fix alongside Blocker 1's rebuild.

## Verified clean (checked, not assumed)

- **Frozen bytes:** `git diff 661d7ac8 --stat` over
  `export-provider.ts`, `index.ts`, `in-memory/`, `host/` (ports) plus the
  three other byte-identical-claimed surfaces (`transactions/opencut/index.ts`,
  `engine.ts`, `surface/embedding/types.ts`) — **empty**.
- **Digest rename completeness:** no `projectUpdatedAt` references remain in
  src/electron/scripts (only the Minor-3 comment); wire types, manager,
  producer and panel consistent; typecheck green on the current tree.
- **Group C runtime risks:** panel subscriptions unsubscribe both channels
  with an `alive` guard (`export-panel.tsx:135-212`); provider
  `awaitSettled` closes the subscribe race with bookend fetches and an
  idempotent finish; capability cache is conservative-false until first
  probe (documented).
- **Evidence honesty elsewhere:** D1's negative leg has real captured state
  (panel text, bridge result, no-leak tasklist); the perf artifact records
  its non-completions as non-completions; screenshots exist
  (`evidence/screenshots/`, d1/d2 panels).
- **LF:** every commit-intended file has 0 CR bytes (checked file-by-file).
- **Ignores:** `apps/electron-host/dist/`, `dist-main/` gitignored; no
  `.rasen/` directory exists; no `node_modules` untracked.

## Out of scope, noted for the LEAD

The running close-out verification (full `bun test`, both-host parity) is
owned by the parent and was still in flight during this review; this pass
does not speak to its outcome.
