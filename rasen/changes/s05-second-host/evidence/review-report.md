# s05-second-host — review report (verify stage)

Reviewer: `reviewer-s05-p2` (non-author; dispatched, report-only). Date: 2026-08-15.
Delta reviewed: `66add22f..9ab57cc7` — 12 commits, branch `feat/s05-community-beta`, local only.
Mode: `rasen-review` DISPATCHED — no fixes applied, no questions asked, no commits made. Read-only on
source; scratch under `E:\ai-scratch-s05p2-review\` (outside the repo). Everything below was
reproduced or read directly unless marked otherwise.

**Verdict: FINDINGS — 1 Blocker, 1 Major, 2 Minor, 3 Trivial.**

The Blocker is not a code defect and nothing has leaked: it gates the portfolio's single
delivery (any push of this branch as-is publishes live credentials baked into cb70b8c5's
reachable blob). The implementation itself is exceptionally solid — every mandated oracle
claim I re-ran reproduced exactly.

---

## Scope check

Scope: CLEAN. Intent (proposal "What Changes"): a third consumer Host at `apps/electron-host`,
declared+derived boundary-checker scan roots, the same scenario evidence on it. Delivered:
exactly that. All 21 modified files and 81 added files fall inside the proposal's Impact
section (parity harness seam, playwright config, boundary.json + 9 checker scripts + 1 fixture,
BOUNDARIES/PARITY, .gitignore, bun.lock, the new app, evidence, tasks.md). No unrelated edits.
Additive only: 81 A / 21 M / 0 D; frozen surfaces untouched (reproduced below).

---

## SEC-1 — credential incident audit (mandated item 1)

Method: masked pattern scan (`sk-ant-`, `sk-sssaicode`, `sk-omnicross`, `cr_<hex24>`,
`fc-<hex16>`, `ghp_`, `github_pat_`) over **every** object reachable from HEAD and not from
base (`git rev-list --objects 66add22f..9ab57cc7`), plus index grep, plus untracked-dir grep,
plus stat-cache-immune hash comparison of every file under `evidence/` against HEAD blobs.

**(a) Reachable blobs: credential material SURVIVES — exactly one blob.**
`rasen/changes/s05-second-host/evidence/logs/gate-1-launch-debug.log` at commit `cb70b8c5`
(blob `81cbbc85`) holds the full `pw:channel SEND> electron.launch` line with the entire
process environment: at least **7 live values** under the keys `ANTHROPIC_API_KEY#`,
`ANTHROPIC_API_KEY2`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN#`, `ANTHROPIC_AUTH_TOKEN3`,
`OPENAI_API_KEY`, `FIRECRAWL_API_KEY` (plus non-secret but sensitive proxy/base URLs). No other
blob in the entire range matches any credential pattern. `cb70b8c5` is an ancestor of HEAD, so
the blob ships with any push of the branch, any PR, and any later archive of the change.

Branch containment verified: `git branch -r --contains cb70b8c5` → empty; origin holds only
`main`, `feat/session-runtime-host-ports`, `feat/vite-portability-baseline`,
`recovery/s0304-ui-commit-routing-final`. **Nothing has left this machine.**

**(b) Committed evidence at HEAD: clean.** e226b109's redaction is complete for its file: the
HEAD blob (`c44c0c94`) has zero credential-pattern hits and zero env-key remnants; the
diagnostic content (executablePath, args) is preserved as the commit message claims. All other
gate-1 logs (`gate-1-launch-check.log`, `gate-1-spike-run.log`, `gate-1-install.log`,
`gate-1-electron-postinstall.log`, `gate-1-diagnostic-dryrun.txt`) scan clean.

**(c) Working tree: clean.** Every file under `evidence/` hash-identical to its HEAD blob;
`git diff` empty; untracked planning dirs (`.rasen/`, sibling `s05-*` change dirs) scan clean;
`apps/electron-host/spike/` does not exist — the spike was never committed (no
`apps/electron-host/spike*` path in any tree in range) and is gone from disk.

**Conclusion:** one reachable credential-bearing blob (cb70b8c5's `81cbbc85`); redaction
complete at HEAD; worktree clean; branch never pushed. Findings F1 (the blob, Blocker) and
F2 (the missing report-flag, Major) below.

---

## Mandated verification record

| # | Claim | Method | Result |
|---|---|---|---|
| 1 | Boundary census final state (group-9 log) | re-ran `node script/check-package-boundary.mjs` live | **byte-identical output** (1078 repo files; 982/360 acyclic; 982/359 public-entry; 863; 1078; 68), exit 0 |
| 2 | Both boundary controls clean | re-ran `--negative-control` / `--converse-control` | both clean, REAL_EXIT_CODE 0 each |
| 3 | `check-type-baseline` red is pre-existing (P1 move artifact) | re-ran live; `git diff 66add22f..HEAD` on the two pinned files and on the checker | **reproduced exactly**: exit 1, the same two TS2769 FAIL rows (`packages/editor-classic/src/timeline/__tests__/update-pipeline.test.ts:69`, `.../placement/__tests__/resolve.test.ts:646`), and the checker's own "present at the pin, absent now" list shows the same TS2769s at their pre-move `src/...` keys. Both files byte-identical to base; checker unchanged since base. **Disposition holds.** |
| 4 | `check-emitted-runtime-assets` red predates branch point | re-ran live; `stat` on `.next`; base commit date | reproduced exit 1 (`relative-next-static-escape`, `static/media/worker.dd71b7fd.ts`); `.next/BUILD_ID` mtime 2026-08-14 12:23 vs base commit 21:24 same day — 9 h before the branch point; checker unchanged since base. **Disposition holds.** |
| 5 | `check-resolution-equivalence` fail-closed, nothing to verify | re-ran live | exit 1, "no rewritten specifiers found in the staged diff — nothing was verified"; the change's diff adds imports but rewrites no existing specifier (81 A / 21 M, no import-specifier rewrites in M files). **Disposition holds.** |
| 6 | §9.3's asset-manifest exit-0 follow-up | read the committed logs | the passing run exists: `evidence/logs/group-5-composition-evidence.log` §[C-retry] — serve-dist stand-in port 4199, 298 entries, PASS MIME+bytes+SHA-256, REAL_EXIT_CODE:0 (the sweep's own two exit-2s at 4173 are the disclosed no-server attempts). Claim is evidence-backed; see F7 for the loose pointer. |
| 7 | Parity: classifier untouched, zero semantic rows outside envelope | `git diff` on `script/diff-parity-snapshots.mjs` (empty); read both parity reports + PARITY.md | classifier byte-unchanged; electron-vs-vite = 25 diff (20 semantic, 5 incidental, 275 leaves); **all 20 semantic rows under `project.__opencutTransaction.idempotency[*]`** — the same classes the committed Vite/Next record documents as the envelope; incidental rows the same documented classes only. Vite+Next regression re-runs recorded green. Pair selection was already argv-driven (no argument change needed). |
| 8 | Agent ledger: 87 assertions, reopen bound to commit | parsed committed `evidence/agent-ledger-electron.json` | apply: 9 steps, sum(assertionCount)=**87**, verdict passed; reopen: **48** assertions, observed 6 == expected 6, passed; staleControl: observed 6 != expected 5, **failed** exactly as demanded; host `electron`, marker `s05-electron-20260815`. Log REAL_EXIT_CODE:0. |
| 9 | C6 durable-reopen PASS + re-proven on rebuilt dist | read both committed logs | `group-8-c6-oracle.log` and `group-10-c6-oracle-rebuilt-dist.log` both `C6 ORACLE PROOF PASSED`, REAL_EXIT_CODE:0; the cycle-1 timer race appears exactly **10/10** attempts in each log, cycle 1 only, 1 handle, never growing — matching the recorded distribution; negatives fail as demanded; the `Tet` constructor and `vite` host-label diagnostics are on the record as contract-blessed diagnostics. |
| 10 | 9.4 frozen signatures byte-identical | reproduced `git show <base>:<path> \| cmp` + blob-sha equality for all four surfaces | **all four IDENTICAL** (transaction barrel, engine, ports barrel, Surface embedding types), both by worktree compare and blob-sha at base vs HEAD. |
| 11 | Census additive, spike deleted pre-commit | per-commit `git ls-tree -r \| wc -l`; `--diff-filter=A` on spike paths | 2299 → 2380, monotonically additive per commit, 0 deletions, no spike path ever committed. Note F3: the documented figure (2376/+77) is stale vs HEAD. |
| 12 | Shared-harness edits confined to the seam | diffed all five parity files | `parity.pw.ts` exactly 2 hunks (seam import; test header/page acquisition/origin), `driver.ts` exactly 2 hunks (HOST import; electron branch inside `importFixtures`), `agent.pw.ts` 4 seam-level hunks, `host-profile.ts` union + ELECTRON profile only (VITE/NEXT bodies untouched), `snapshot.ts` dispatch addition. Browser-host chooser dance and vite/next reader bodies unchanged; regression control (item 7) is the behavioral proof. |
| 13 | Task 4.5 non-vacuity assertion already paid | `git log`/`git show 8389be4e`; diff on the test file | assertion present at base (`8389be4e`, ancestor of base); file untouched by this change. The "already paid" claim is honest and correct. |
| 14 | `typecheck` green | re-ran `bun run --cwd apps/electron-host typecheck` | REAL_EXIT_CODE:0. |

### Deviations (mandated item 5)

- **G4 `runStorageMigrations` (Minor, F4):** the causal claim is TRUE —
  `packages/editor-classic/src/services/storage/migrations/runner.ts:32-36` constructs
  `new IndexedDBAdapter({ dbName: "video-editor-projects" })` directly; the runner cannot run
  under bun or against a filesystem. The store's own walk
  (`apps/electron-host/src/store/filesystem-project-store.ts:756-877`) sequences the same
  published `migrations` list + `CURRENT_PROJECT_VERSION` and is **strictly safer than the
  runner**: it transforms all candidates in memory before any write (all-or-nothing), treats a
  refusing transform as a failure where the runner merely `break`s, and requires the chain to
  reach current. Probe-verified (5/5). See F4 for the spec-letter mismatch.
- **G5 single-origin assets: sanctioned.** Spec
  (`specs/sdk-desktop-reference-host/spec.md:55-61`) requires assets "under the Host's own
  scheme" — satisfied by `opencut://app/...` with base `"/"`
  (`electron-host-config.ts:56-62`); the deviation is from design E2's two-host *sketch* only,
  recorded at the composition site and in the Group 5 evidence. No finding.
- **G6 `hostName` cast (Trivial, F5):** `surface-evidence-main.tsx:57`
  `hostName={"electron" as unknown as "next" | "vite"}` — value-truthful (the harness renders
  `data-host="electron"`; ledgers carry `host: "electron"`), comment in place, harness
  untouched as task 6.1 demands.
- **CSP `connect-src 'self' blob:` relaxation: sanctioned.** Design E7's own mechanism
  ("hypothesis, not a decision; any relaxation names the feature"); the policy string is
  byte-identical in all three homes (`electron/main.cjs:40-49` with the attribution comment,
  `index.html` meta + comment, `surface-evidence.html` meta + comment), each naming the C6
  oracle's object-URL terminality probe. Spec scenario "Relaxations are attributed": met.

### Correctness review of the new trust boundaries (mandated item 7)

- **Scheme handler traversal guard** (`electron/main.cjs:100-138`): decodes the pathname
  BEFORE resolving, `path.resolve` against `DIST_ROOT`, containment via
  `resolved === DIST_ROOT || startsWith(DIST_ROOT + sep)` — catches `..` chains, percent-encoded
  separators, backslashes (Windows separator semantics), and absolute-path replacement
  (`/C:/...` resolves outside DIST_ROOT → 403). Entry names validated
  (`/^[a-z0-9][a-z0-9-]*$/`, main.cjs:89) before URL interpolation. Sound.
- **Preload surface** (`electron/preload.cjs`): exactly one exposed global, 14 operations,
  identifiers + structured-clone values only, no `node:` requires (comment-only mentions), no
  path literals. Matches task 4.6; drift pinned by `store-bridge-surface.test.ts`.
- **IPC handlers** (`src/store/main-store-ipc.ts:90-138`): every handler correctly takes
  `(_event, ...args)` — the caught-and-fixed launch bug is now pinned by the
  `StoreIpcMain` interface's own doc.
- **Identifier-to-segment mapping** (`node-fs-store-bridge.ts:86-110`): ids matching
  `[A-Za-z0-9][A-Za-z0-9._-]*` (≠ `.`/`..`) pass readable; everything else becomes
  `~`+base64url; `~` is outside the plain alphabet so encoded/plain never collide. No
  separator, drive colon, or traversal sequence can reach the path join. Sound.
- **Atomic writes** (`node-fs-store-bridge.ts:148-177`): sibling temp → rename, fd closed
  before rename, failure path closes fd + unlinks temp + sanitizes to a path-free
  `StoreBridgeError`. Matches design E4 exactly. (No fsync-before-rename — the standard
  accepted discipline for this class; the design asks only temp+rename.)
- **Electron posture**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
  (main.cjs:171-176); electron exact-pinned `43.4.0`; `private: true`; no
  `webSecurity`/remote-content relaxations anywhere in the app.
- **Cross-app build import** (`vite.config.ts:13-14` imports `../vite-example/build/*`): the
  design-prescribed single-source allowlist (E5); consumer↔consumer edge, excluded from
  acyclic-direction by design and recorded in the audit. No `@opencut/*` imports exist outside
  the app's `src/` scan root (verified by grep) — no deep-import hole behind the `.cjs`/`.mjs`
  files.

---

## Findings

### F1 — Blocker — SEC-1a: live credentials remain reachable in cb70b8c5's blob; any push of this branch publishes them

- **Where:** blob `81cbbc85` of
  `rasen/changes/s05-second-host/evidence/logs/gate-1-launch-debug.log`, reachable at commit
  `cb70b8c5` (ancestor of HEAD `9ab57cc7`).
- **What:** the redaction commit e226b109 fixed the HEAD copy only; git history still carries
  the original full-env dump (7+ live values: `ANTHROPIC_API_KEY#`, `ANTHROPIC_API_KEY2`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN#`, `ANTHROPIC_AUTH_TOKEN3`, `OPENAI_API_KEY`,
  `FIRECRAWL_API_KEY`).
- **Failure scenario:** the portfolio delivers once, at the parent, per plan ("children ship
  local; the portfolio delivers once"). That delivery pushes `feat/s05-community-beta`; the
  pushed pack necessarily includes cb70b8c5 and its blob; anyone with read access to
  github.com/DumoeDss/rocut harvests working API credentials (Anthropic OAuth-style tokens —
  billing-attached — plus Firecrawl and relay endpoints). Rotation after the fact chases keys
  already scraped by bots within minutes of a public push.
- **Exposure today: none.** No remote ref contains cb70b8c5 (verified). The finding gates
  delivery; it does not indicate a leak.
- **Remediation (either, before the parent's push):** (1) history rewrite — replay the branch
  with cb70b8c5's evidence-log blob replaced by the redacted bytes (the natural seam:
  cb70b8c5+e226b109 collapse into one clean commit), done **before P3–P7 stack more commits on
  top** (cost grows with every child); note the local reflog keeps the old blob until expiry,
  which matters only for this machine, not for the push; or (2) rotate every exposed value.
  Given seven-plus values across at least three providers, the rewrite is the cheaper and
  complete option; rotation is the belt to the rewrite's braces.

### F2 — Major — SEC-1b: the promised final-report disclosure of the incident never landed

- **Where:** `evidence/implementation-report.md` (whole file), `evidence/gate-1-desktop-substrate.md`,
  `BOUNDARIES.md` — zero occurrences of credential/redact/env-dump language (verified by
  grep). The disclosure exists only in e226b109's commit message.
- **What:** the redaction commit says "flagging to the lead in the final report"; the final
  report says nothing.
- **Failure scenario:** the verify/archive path reads the implementation report as the
  authoritative close-out record. Any reviewer or archiver working from the evidence bundle
  (the normal path — exactly what this review would have been without the dispatch's explicit
  SEC-1 mandate) concludes the change's only security-relevant event is the CSP relaxation.
  The one finding that gates the portfolio's entire delivery becomes invisible in the
  artifact that outlives the conversation. F1's remediation then depends on someone
  remembering a commit message from three children ago.
- **Remediation:** add the incident + remediation plan to `implementation-report.md` (one
  paragraph: what was captured, where the original bytes live, the delivery gate) as part of
  the F1 fix commit.

### F3 — Minor — BOUNDARIES.md census is stale by its own commit: 2376/+77 documented, 2380/+81 actual

- **Where:** `BOUNDARIES.md:854-855` ("the repo census moves 2299 → 2376 tracked files across
  this change (+77, 0 removed…)"), echoed in `implementation-report.md` §9.5.
- **What:** 2376 was true at the Group-8 commit (ca05c2fa); BOUNDARIES.md landed in 689700fc
  which itself pushed the count to 2379, and the Group-10 close-out commit ended at 2380.
  Direction unaffected (still additive, 0 removed — verified per commit).
- **Failure scenario:** a later child reconciling its own census delta against §12 inherits a
  base number 4 files short, and its "additive" check silently mis-reconciles. Minor because
  the checker census (the actual regression test under the doctrine) is recorded correctly
  and reproduces; this is the git-file count, a documentation figure.
- **Remediation:** one-line correction to `BOUNDARIES.md` (2299 → 2380, +81) in the F1 fix
  commit or the archive's doc pass.

### F4 — Minor — G4: the spec's migration letter says "by the published migration runner"; the implementation runs the runner's published transforms, not the runner

- **Where:** `specs/sdk-desktop-reference-host/spec.md:142-144` ("Migration SHALL be proven
  against a seeded legacy on-disk record brought forward by the published migration runner")
  and scenario at :160-164; design.md E4 and task 4.2 say "delegating to runStorageMigrations";
  implementation at `apps/electron-host/src/store/filesystem-project-store.ts:756-877`.
- **What:** delegation is impossible without touching a frozen surface — the runner opens
  IndexedDB directly (`runner.ts:32-36`). The store sequences the same published
  `migrations` + `CURRENT_PROJECT_VERSION` per-record, all-or-nothing, fail-closed (strictly
  safer than the runner's break-on-skip). Deviation disclosed in the implementation report
  with correct reasoning; probes verify the behavior (5/5).
- **Why a finding at all:** when this delta spec syncs into the main specs at archive, the
  main spec will carry a THEN-clause the implementation does not literally satisfy, and P3's
  conformance harness (per planning-context #4, "a filesystem store delegates to them
  wholesale") will re-trip the same wall. The unsatisfiable letter should not propagate.
- **Remediation:** at spec-sync time, restate the requirement as "by the published migration
  artifacts (the transform chain + version constant) under the store's own sequencing", or
  schedule a package-side extraction of a runner-core export (a legal, attributed export-map
  addition) for a later child.

### F5 — Trivial — G6: the `hostName` double-cast is a type-level lie kept honest only by convention

- **Where:** `apps/electron-host/src/surface-evidence-main.tsx:57`.
- **What:** `{"electron" as unknown as "next" | "vite"}` — value-truthful today (harness
  renders and records `electron`; it does not branch on the prop), comment documents the
  reasoning, deletes cleanly if the union widens.
- **Failure scenario:** a future harness revision starts branching on `hostName` (e.g.
  vite-specific behavior); the cast silences exactly the type error that would have flagged
  the untested combination. Low likelihood, cheap to hold as accepted-known.

### F6 — Trivial — 403/404 scheme responses carry no CSP header, against the spec's "every response" letter

- **Where:** `electron/main.cjs:95-97` (`notFound()`) and `:118` (the 403 path) vs
  `specs/sdk-desktop-reference-host/spec.md:79-80` ("every response under that scheme SHALL
  carry a committed, narrow content security policy").
- **What:** only 200 responses get the header. The bodies are plain-text "not found"/
  "forbidden" with no executable content, so there is no practical exposure; the letter is
  stricter than the intent. Note for completeness; not worth code churn unless the spec-sync
  keeps the absolute letter, in which case adding the header to the two error responses is a
  two-line change.

### F7 — Trivial — §9.3's headline counts are loose against its own log

- **Where:** `implementation-report.md` §9.3 ("Green: 22. Nonzero, each with a named cause")
  vs `evidence/logs/group-9-all-checkers.log` (30 `EXIT[...]` lines: 23 zero / 7 nonzero —
  `asset-manifest:2`, `asset-manifest-live:2`, `emitted:1`, `headless-graph:2`,
  `headless-semantic-result:2`, `resolution:1`, `type-baseline:1`).
- **What:** every nonzero exit IS named with a cause in the same section (nothing silently
  waived — I reproduced the three pre-existing ones live), but "22 green / 3 nonzero" is a
  summary arithmetic that doesn't tally with the log's own lines. The asset-manifest exit-0
  claim is real but its evidence lives in the group-5 log (`[C-retry]`), which §9.3's phrasing
  ("the follow-ups the sweep could not carry") doesn't point at explicitly.

---

## Durable findings for future children

1. **`DEBUG=pw:channel` + `_electron.launch` dumps the whole process env into the transcript,
   and a redaction commit does not redact history.** Any future Electron/Playwright evidence
   capture must pass an explicit `env` to `launch` (or scrub before the first commit); once a
   credential-bearing blob is committed, only history rewrite or rotation remediate — and the
   rewrite must happen before later children stack commits (F1). P7's provenance generation
   walks git history and must not re-surface the blob: whichever child delivers the portfolio
   push carries F1's gate.
2. **The C6 disposal oracle is CSP-load-bearing for non-HTTP origins:** its object-URL
   terminality probe *fetches* the `blob:` URL it creates, so any custom-origin host running
   C6 needs `connect-src ... blob:` — an attributed relaxation per host, not a global policy
   change. P3's conformance harness will hit this if it ever runs C6 outside a browser origin.
3. **`runStorageMigrations` is IndexedDB-hardwired** (`runner.ts:32-36`); every non-browser
   store must replicate the per-record walk over the published transforms (see F4). P3's
   scratch-project adapter work inherits this; a package-side runner-core export is the
   structural fix and is a legal attributed export addition under the monotone-growth rule.

---

## Notes

- Real-exit-code discipline verified throughout: every headline evidence log carries
  self-logged `REAL_EXIT_CODE` lines; intermediate failing runs are preserved honestly
  (group-4 bridge production 1/1/0, group-5 2 then 0, oracle gate-development note).
- Line endings: this report was written via the Write tool and normalized to LF afterward
  (`tr -dc '\r' | wc -c` = 0) per the repo's LF-in-worktree discipline.
- Reviewer scratch: `E:\ai-scratch-s05p2-review\` (outside the repo). No repo source was
  modified; no commits were made; the only repo write is this file.

---

## Round 1 re-review (fix delta, 2026-08-15)

Reviewer: `reviewer-s05-p2` (same non-author reviewer). Delta: history rewrite (cb70b8c5+e226b109
collapsed to N1 `8d3de9c6`, 10 commits replayed to `485eafdb`) + fix commit `f09063e0`. Every
claim below was reproduced by me, not read from the implementer's record. Read-only; the only
repo write is this appended section.

### Per-finding verdicts

- **F1 (Blocker) — FIXED, verified.** `git rev-list --objects --all | grep 81cbbc85` → **0**
  (reproduced myself; the credential blob is unreachable from every ref). N1's tree equals old
  e226b109's tree (`git diff --stat e226b109 8d3de9c6` → 0 lines) and carries the natively
  redacted blob `c44c0c94`. The replay is content-identical: `git diff 9ab57cc7 485eafdb` →
  **empty** (final tree unchanged pre-fix). The fix commit (`485eafdb..f09063e0`) touches
  exactly the fix surfaces (8 files, all expected; no drive-by edits). N1's message is honest —
  it describes the env-dump mechanism, states the redaction is native to the commit, contains
  no credential content, and makes no "never happened" claim (the full incident is recorded in
  rewrite-record.md, implementation-report.md, gate-1-desktop-substrate.md, and BOUNDARIES.md).
  Masked credential scan over **all** objects reachable from HEAD-not-base: the only hit is
  this report's own method line naming the pattern classes (lines 31-32) — zero credential
  values anywhere. No remote ref contains any pre-rewrite commit (checked cb70b8c5 and
  9ab57cc7). The blob survives locally via reflog until expiry — disclosed in the record,
  unreachable by any push. `check-package-boundary.mjs` green at fix HEAD with the census
  unchanged from round 1 (1078/982-360/982-359/863/1078/68). Screenshots blob-identical
  pre/post rewrite (tree-equality corollary, spot-checked on 3 of 5).
- **F2 (Major) — FIXED.** Incident section in implementation-report.md with all **seven** key
  names (`ANTHROPIC_API_KEY#`, `ANTHROPIC_API_KEY2`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_AUTH_TOKEN#`, `ANTHROPIC_AUTH_TOKEN3`, `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`),
  honest framing (admits the original capture wrote live values, admits the follow-up-redaction
  left the blob reachable, points at rewrite-record.md), plus the incident note in
  gate-1-desktop-substrate.md and the capture rule in BOUNDARIES.md §12.
- **F3 (Minor) — FIXED.** BOUNDARIES.md §12 + implementation-report §9.5 now read 2299 →
  **2380**, **+81**, 0 removed. Verified by my own count: 2380 at `485eafdb` (the close-out
  commit the documented method names); 2383 at fix HEAD, the +3 being the review-round
  artifacts themselves. See F9 for the method-annotation nit.
- **F4 (Minor) — FIXED.** The delta spec's migration requirement and its scenario THEN-clause
  are restated to the actual mechanism ("the store sequencing the published migration transform
  chain, all-or-nothing", with the IndexedDB constraint named) — matching what the code does
  and what round 1 verified. All 19 scenario headings are verbatim against my pre-fix read.
  `rasen validate s05-second-host --strict --project rocut --json` → valid, 0 issues
  (reproduced). The spec file is untracked by design (lead's sync domain) — noted, not a
  defect.
- **F5 (Trivial) — NOT FIXED AS CLAIMED (new F8).** The accepted-known disposition stands (the
  cast is value-truthful, the harness is frozen by task 6.1, the code comment at the call site
  makes no false claim), **but the justification added to the implementation report is
  technically false**: it claims the single-cast form (`"electron" as "next" | "vite"`) "does
  not compile — TS2352 otherwise". I reproduced under the app's own TypeScript 5.9.3
  (`apps/electron-host/node_modules/typescript`) and the root 6.0.3: the single cast compiles
  **clean** (REAL_EXIT_CODE:0, no diagnostics) — as does even the fully disjoint
  `"electron" as "next"`. Literal-to-literal assertions pass TS's comparability check in these
  versions; the `as unknown as` crossing is not required for compilation. The true
  justification (frozen harness + value-truthful label) was already sufficient.
- **F6 (Trivial) — FIXED.** `electron/main.cjs` now attaches the CSP header to the 404
  (`notFound()`) and 403 responses (diff read; trivially correct — same `CSP` constant as the
  200 path). Boot gate re-run: `BOOT PROOF PASSED`, `REAL_EXIT_CODE:0`, `cspViolations: []`,
  `consoleErrors: []` (`evidence/logs/review-r1-boot-gate-csp-error-responses.log`). Note the
  log is a happy-path regression proof, not an error-path header probe — proportionate for a
  Trivial whose fix is verifiable by inspection.
- **F7 (Trivial) — FIXED.** §9.3 now tallies "23 zero / 7 nonzero across the 30 EXIT lines" —
  matching my own round-1 count exactly — and points explicitly at
  `group-5-composition-evidence.log` §[C-retry] for the asset-manifest exit-0 evidence, naming
  the two exit-2s as the disclosed no-server attempts.

### New findings this round

- **F8 — Minor — false TS2352 claim in the F5 disposition** (see above). The evidence record
  now contains a compile-necessity claim that is false under both compilers this repo uses; a
  future maintainer reading it would believe the double cast is load-bearing when a single
  `as` compiles fine. Fix: delete the "does not compile — TS2352 otherwise" sentence from
  implementation-report.md's F5 bullet (the remaining justification is true), optionally
  simplifying the cast at `surface-evidence-main.tsx:57` to a single `as`.
- **F9 — Trivial — BOUNDARIES' census figure carries no method annotation.** §12 states
  "2299 → 2380 (+81)" without saying the count is taken at the change's close-out commit; the
  ship HEAD is 2383 (+84 with the review artifacts). The method is documented only in the
  implementation report. One clause in BOUNDARIES ("at the change's close-out commit") makes
  the figure audit-proof against the next post-close-out addition.

### Sweep of the fix delta for new defects

Fix commit touches 8 files, all in scope. Stale-hash sweep across all tracked files: the only
pre-rewrite shas remaining anywhere live in the three deliberate historical records
(review-report.md, rewrite-record.md, and the implementation report's incident/disposition
sections, which cite them as history) — exactly matching the disposition's own claim;
`frozen-signature/README.md`'s one live reference was updated to `8d3de9c6`. The dispatch's
"restored screenshot claim" has no referent in this delta — no restore/screenshot text appears
in the fix diff or the evidence markdowns, and the screenshots are blob-identical across the
rewrite. Boundary checker green at HEAD. No new defects found beyond F8/F9.

### Round 1 verdict

**FINDINGS — F1/F2/F3/F4/F6/F7 verified fixed; F5's disposition carries one false sub-claim
(new F8, Minor); one Trivial method-annotation nit (F9).** F8 is a two-line evidence-text
correction; nothing this round blocks ship once it lands.
