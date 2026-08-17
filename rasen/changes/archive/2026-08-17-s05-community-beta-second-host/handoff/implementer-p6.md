# Implementer handoff — s05-published-examples (P6) → P7 (provenance-and-beta-closure)

Written at retirement (review loop closed CLEAN in one round — 0 Blocker / 0 Major /
4 Minor / 5 Trivial, all nine fixed or recorded in one batch, commits 4b979b67 +
d4340b67; shipped and archiving as 3ba5f230 per the lead). Dual-seed P7's implementer
with this document plus P7's own change artifacts. Cross-change-transferable knowledge
only; P6-internal narrative lives in the child's `evidence/implementation-report.md`
(Groups 1–7 + the P7-handoff section + review round 1) and `evidence/review-report.md`.

## 1. Conventions that held, and what changed

**Held from P2/P3/P5:** one `feat(<change>):` commit per tasks.md group (fix batches
take `fix(<change>):`), explicit pathspecs only, the `.rasen/` staging guard before
every commit, LF-in-worktree verified after every write, local commits only,
per-group report sections, one review-round dispositions section per round, every
headline log self-logging `REAL_EXIT_CODE`. Evidence/artifact tracking split
unchanged. New this child, keep both:

- **Commit the fixes BEFORE the evidence they prove.** When a review round regenerates
  evidence, land every code/doc fix as its own commit FIRST, then run the evidence
  runs at that committed HEAD — the regenerated log then self-certifies a tree that
  contains the fixes (this round's R3 was exactly the missing half of that ordering:
  a log labeled at a commit that did not contain what it proved).
- **Commit the reviewer's report with the change's evidence** (it is untracked when
  the reviewer finishes; archived children carry `evidence/review-report.md`).

## 2. The durable P7 list — consolidated in the report's "P7 handoff" section

The implementation report ends with a consolidated "P7 handoff — durable findings"
section; everything below also lives there, verbatim where it matters.

- **The packed-manifest dependency-closure checker does not exist. Build it
  reachability-aware, or declare-and-document instead.** Seed set, verbatim from the
  round-1 probe: zustand's peers `immer` (imported only by
  `zustand/esm/middleware/immer.mjs`) and `use-sync-external-store` (imported only by
  `zustand/traditional.js` / `zustand/esm/traditional.mjs`) are undeclared by classic
  but LATENT-ONLY — classic imports just `zustand`, `zustand/vanilla`,
  `zustand/middleware`, and the middleware barrel is a self-contained bundle with
  zero immer references. Level-1 residuals `@napi-rs/canvas` and `bun:test` are
  test-file-only and README-dispositioned. Probe design to reuse: level-1 =
  bare-specifier scan of the EXTRACTED tarball vs the packed manifest; level-2 =
  peers of declared deps that the dep's own code imports, eliminated by subpath
  reachability. NOT built in P6 (LEAD routing: record, don't build).
- **The manifest-truth corollary (F-P6-7):** a peer of a dependency that the
  package's closure needs must be promoted to the package's own dependencies —
  `--legacy-peer-deps` consumers never auto-satisfy peers, and bun auto-installs
  peers in the monorepo, so the workspace never sees what an npm consumer misses.
  classic now declares `date-fns ^3.6.0` (react-day-picker's peer; the peer range is
  the load-bearing fact, identical across 8.10.x).
- **bun.lock's classic workspace entry is stale** (records four deps, predates the
  F-P6-1 repair). No gate consumes the lock's workspace map and CI installs
  non-frozen; the resolved set is unchanged. Refreshing it is P7's tidy. Do NOT
  attempt `bun install --frozen-lockfile` against it — it times out (4 min here) and
  the staleness predates P6 at HEAD.
- **Self-certifying logs:** every authoritative log names the revision it ran at;
  generalize the `<HEAD>+worktree` label so no log's tree state has to be re-derived
  from count arithmetic (R3's lesson; this round's regenerated logs all self-label).
- **Commit the FAIL half of every violation-and-revert control** (R1's lesson; the
  green twin alone is not the evidence — the committed FAIL log is).
- Also carried: F-P6-3 (culori ships no declarations — from-tarballs consumers must
  `declare module` it; classic's README could name it), F-P6-4/5/6 (classic-README
  consumer obligations: the `@source` self-registration against silently half-styled
  builds, the definite-height wrapper, the empty-scene seed trap).

## 3. P7's scope mechanics as this change leaves them

- **SOURCE_INVENTORY.{md,json} + PATCHES.md sit at the repo root** (all three
  git-tracked). The generator derives fork additions from `git diff --name-status`
  against the upstream pin. History to know: P1's 863 renames restated the inventory
  wholesale, and S03+S04 shipped with ~95 entries of accumulated drift. The
  regeneration is P7's core deliverable and must run at the SHIP commit — plan §4's
  "last child by necessity" note: any earlier child would only re-drift it. P6 added
  fork surface the regeneration will pick up (see §4).
- **SBOM:** `script/generate-sbom.mjs` exists at the repo root; P7 drives it.
- **Notices are verified INSIDE packed tarballs, never in the worktree.** The
  manifests' `files` arrays decide what a consumer actually gets (they became
  load-bearing in P5) — inspect pack output (extract it, or `tar -tf`), not the
  source tree. Contracts' files field today: `dist, src, surface.json, README.md,
  LICENSE, NOTICE`.
- **`rust/wasm/LICENSE` exists** and is P7's to place/verify in the redistributed
  set.
- **The fourth tarball is a distributed artifact P7's inventory must account for.**
  P3's `packSdkTarballs` packs `opencut-wasm-0.2.10.tgz` from `rust/wasm/pkg` — a
  flat artifact with no exports map and no surface.json (the consumer-view checker
  logs it as "flat artifact … no surface clauses"). Three packages at 0.2.0 plus
  this at its own 0.2.10.

## 4. The examples/ estate P7's diff will see

- `examples/{install-packages,agent-transaction,custom-storage,embed-surface}/` —
  four independent projects, NOT workspace members (globs are `apps/*`,
  `packages/*`), plain exact pins (`0.2.0`) that the runner resolves to
  `file:tarballs/*` at materialization. `packages/boundary.json` carries
  `{ "id": "examples", "root": "examples" }` (the vite-example consumer shape).
- Three new scripts: `script/run-published-examples.mjs`,
  `script/scratch-install-harness.mjs` (`createScratchHarness` — the extracted P3
  lifecycle/controls), `script/check-sdk-consumer-view.mjs` (the family's 29th
  checker; env seams `OPENCUT_PREPACKED_DIR`, `OPENCUT_TARBALL_OUT_DIR`).
- The `sdk-examples` CI job in `.github/workflows/bun-ci.yml` (ubuntu, env-driven,
  scratch under `$HOME`; first true CI execution lands on the post-delivery push —
  stated in the job comment itself).
- Census at close: 1135 repo files; family 29 checkers, 23 exit-zero / 6 nonzero,
  the nonzero set byte-identical to P5's known six. The four S03+S04 frozen
  surfaces re-proved byte-identical vs `5aae75ec` through the round.
- **Legal notice content in example files is P7's** (BOUNDARIES §15 non-coverage
  paragraph says so outright). The examples currently carry none — that is recorded
  non-coverage, not an omission to "fix" before P7.

## 5. Tooling traps new beyond P5's set

- **Green-by-leakage is a defect CLASS, and the control is now fail-closed.** Node
  resolves bare imports by walking `node_modules` up to the drive root, so any
  ancestor of a scratch root carrying `node_modules` can satisfy an import the
  scratch tree never installed — a green run then proves nothing about the packed
  artifacts. CONTROL-1c in `scratch-install-harness.mjs` refuses such roots before
  touching anything: the E:-drive default root REFUSES on this machine, by design —
  do not treat that refusal as a bug to work around. Every P7 run that packs,
  extracts, installs or verifies (all of P7's provenance legs) sets
  `OPENCUT_SCRATCH_ROOT` (or the output dir seam) under the user profile, which is
  ancestor-clean. This class masked a real one-package-short manifest for three
  groups of evidence; it will mask P7 defects the same way if the root is dirty.
- **Long runs: background + bounded polling turns (≤270 s each), NEVER one blocking
  foreground call.** Two workers died mid-run on the blocking shape this cycle. The
  converse trap is equally real: a COMPLETED background run looks like a stall from
  outside (notifications surface late; 43 quiet minutes here while the run had
  finished green). Discriminate on the log's own completion marker + mtime, never
  on silence alone, and never re-run on silence before checking the marker.
- **CRLF: verify at BLOB level, not worktree level.** The Write tool emits CRLF
  inconsistently; a worktree check can pass while the committed blob carries CR.
  After every commit: `git show HEAD:<path> | tr -dc '\r' | wc -c` = 0 over the
  round's files.
- **An evidence-only delta does not invalidate execution evidence when the delta's
  file list is verifiably non-executable.** Pair the changed-file list against
  executability (logs, reports, audits vs code/config) and say so in the round
  section — do not reflexively re-run the battery for a docs-only delta. When code
  DID change, re-run at the committed tree (§1's ordering).
- **Prepacked-mode staleness (F-P6-2):** `OPENCUT_PREPACKED_DIR` verifies whatever
  bytes sit in the dir — tarballs packed during a violation window keep carrying it.
  Pack-in-time is part of the proof: verify tarballs you JUST staged, never a dir
  with history. The tarball-level negative-control pattern that closes R1 cleanly:
  pack fresh, doctor a COPY in scratch (declare the synthetic entry in BOTH the
  export map and surface.json so set-equality holds and only the target branch can
  fire), run the checker over `OPENCUT_PREPACKED_DIR`, prove repo-untouched with
  in-log `git status --porcelain`, commit the FAIL.
- **Re-hits from this cycle worth re-flagging:** `node | sed; echo $?` captures
  sed's exit, not node's — `${PIPESTATUS[0]}` (the P5 trap, paid again); `grep -c`
  exits nonzero on zero matches and silently breaks `&&` chains. And citation
  hygiene: grep that every cited evidence artifact EXISTS before writing a pairing
  (R1 was a "run record" that never existed), and verify the file:line you cite
  actually holds the phrase (R5's count lived in the report, not the audit).

## 6. Dead ends and eliminated hypotheses

- **Refreshing bun.lock mid-child via `--frozen-lockfile`: abandoned.** Times out
  (4 min); the staleness predates P6 at HEAD, no gate consumes it, CI installs
  non-frozen. P7's tidy, on P7's clock.
- **Working around the CONTROL-1c default-root refusal: eliminated.** The refusal
  IS the control; the move is a clean root, not a bypass.
- **Blanket-declaring classic's full 33-specifier source closure: eliminated.** The
  method that held twice now: declare what the FORCING consumer needs, same commit,
  attributed (P3's react-free closure; P6's React-bearing closure via
  embed-surface — the 30-package repair was method-right but one package short,
  caught only by the CI-shaped clean-root run and completed as date-fns).
- **Re-running the full battery for a docs-only review delta: eliminated** (the
  non-executable-delta rule, §5).
- **Inventing an export entry for an example: never needed.** The escalation clause
  never fired across four examples; consistent with the `./vectors/drivers` ruling —
  no barrel for symmetry, ever.
- **A one-sided violation proof: eliminated as evidence.** The FAIL log without its
  green twin, or the green twin without the FAIL, is half a proof; commit the pair
  (R1, and the standing rule in §2).

## Remaining

(empty — P6 retired between children; nothing is in flight)
