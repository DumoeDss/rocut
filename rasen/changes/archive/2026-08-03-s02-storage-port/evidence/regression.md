# C5 final regression evidence — blocked Phase B run

Run id: `20260802-155342`  
Phase-B window: 2026-08-02 16:21:18 through 16:31 +08:00  
Product cwd: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`  
HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
HEAD tree: `286272307b05d23826ffa7223a76695365194dba`

This is a truthful blocked final-verification record. Phase A passed tasks 11.1-11.4, but the protected parity diff in task 11.5 failed. Tasks 11.7-11.12 were therefore not executed and no final ship/verification PASS is claimed. Product source, tests, tasks, run state, and the protected parity fixture/oracle were not edited by this operator.

## Verdict

| Task                              | Result      | Evidence                                                                                                                                                                 |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 11.1 focused C5 matrix            | PASS        | Phase A: focused/unit/negative controls green; Chromium 1/1 and 3/3; see `final-verification-phase-a.md`.                                                                |
| 11.2 exact type ceiling           | PASS        | Phase A: exactly the three inherited `file + code + message` identities.                                                                                                 |
| 11.3 fresh Vite build/manifest    | PASS        | Phase A: Vite 7.3.6, 2,887 modules, attributable +14, 298 copied / 7 emitted.                                                                                            |
| 11.4 fresh Next build/routes      | PASS        | Phase A: Next 16.1.3, 18/18 static pages, standalone output, unchanged `tsconfig.json`.                                                                                  |
| 11.5 protected parity             | **FAIL**    | Both Host scenarios passed 1/1 with ten error-free interactions, but the unchanged diff oracle exited 1: **408 leaves, 12 semantic, 15 incidental**, instead of 195/0/9. |
| 11.6 parity tree/oracle integrity | PASS        | Protected source status/diff empty; tree `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`; oracle blob/worktree blob `fa387ebea1e7f0cc1110eebcb922d393a1337842`.               |
| 11.7 source/emitted graph         | UNEXECUTED  | Hard-stopped after 11.5 so a later product fix cannot inherit stale graph evidence.                                                                                      |
| 11.8 WASM gates                   | UNEXECUTED  | Same hard stop.                                                                                                                                                          |
| 11.9 protected hashes             | UNEXECUTED  | Same hard stop; 11.6 parity identities only were recomputed.                                                                                                             |
| 11.10 full regression             | UNEXECUTED  | Same hard stop; no full-suite result is claimed.                                                                                                                         |
| 11.11 inventory/provenance/SBOM   | UNEXECUTED  | No intent-to-add or generator ran; index and generated inventories were not changed.                                                                                     |
| 11.12 final regression evidence   | **BLOCKED** | This file records the failed/unexecuted state; it is not ship-valid evidence.                                                                                            |

## Preserved Phase-A inputs

At 2026-08-02 16:21:18 +08:00, Node was `v24.14.0`, Bun was `1.2.2`, HEAD/tree matched the values above, ports 4175/4177/43551/43552 were clear, and zero task process referred to the product worktree.

| Input                                             | Verified value                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/vite-example/dist-c5-final-20260802-155342` | 307 files / 34,884,579 bytes; directory timestamp `2026-08-02T16:02:46.0514009+08:00`                             |
| `module-graph.json` SHA-256                       | `1A5C25DFBA013839B7A30D93E26E831657766386596C96CB71E3F75330435348`                                                |
| `asset-manifest.json` SHA-256                     | `A72E6DB50AD2966085BB67E4371586A392D287F59A38808689BF1C3BFF6C8ED0`                                                |
| `apps/web/.next`                                  | 2,515 files / 260,856,302 bytes before Phase-B standalone assembly; timestamp `2026-08-02T16:11:26.3895725+08:00` |
| app standalone `server.js` SHA-256                | `D28F04A0D0A2A1098AE7835C65FA2A4372DEE8446EEB020FF00C2ECC3123FAD1`                                                |
| `apps/web/tsconfig.json` SHA-256                  | `27118CD61C4398A8DC6F8147FC9DA5C030A86DDAA1A2627164DDC5D5B4D93B78`                                                |
| ignored Content Collections input                 | present, 3 files, preserved                                                                                       |

The nine required Next environment names were loaded from `apps/web/.env.example` for the owned standalone process and were present 9/9; values were not logged: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MARBLE_API_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `MARBLE_WORKSPACE_KEY`, `FREESOUND_CLIENT_ID`, `FREESOUND_API_KEY`.

## 11.5 command and process ledger

### Vite Host

- Owned preview command from `apps/vite-example`: `bun run preview -- --port 43551 --strictPort --host 127.0.0.1` with environment names `OPENCUT_PUBLIC_BASE`, `C4_VITE_OUT_DIR`, and `VITE_C4_BUILD_MARKER` selecting the preserved Phase-A output. It started at approximately 16:22:55.
- Owned process chain: Bun PID 55912 -> `vite.exe` PID 15876 -> Node/Vite listener PID 47552 on 43551. `GET /` returned HTTP 200; no foreign server was reused.
- An initial PowerShell wrapper attempt at 16:23:36 promoted Bun's normal `$ playwright test` stderr line to a terminating `NativeCommandError` before Playwright began. It created no parity output and is operator error, not product evidence.
- Authoritative command from `apps/vite-example`: `bun run test:parity` with `PARITY_HOST=vite`, `PARITY_BASE_URL=http://127.0.0.1:43551/`, `PARITY_NO_WEBSERVER=1`, `C4_VITE_OUT_DIR=<preserved Phase-A output>`, and `OPENCUT_PUBLIC_BASE=/`.
- Start/end: `2026-08-02T16:24:27.2615757+08:00` / `2026-08-02T16:25:21.8962089+08:00`; exit 0; 1/1 passed in 52.7s (test 47.7s).
- The recorded listener was stopped leaf-first and parent wrappers exited; port 43551 was clear at `2026-08-02T16:26:03.9059003+08:00`.

### Next Host

- Standalone assembly copied `apps/web/public` to the app standalone `public` child (336 files / 4,935,208 bytes) and `apps/web/.next/static` to its `.next/static` child (100 files / 93,229,032 bytes). Both destinations were absent before the bounded copy; assembly completed at 16:26:46.
- Owned command from the exact standalone app directory: `node server.js`, with the nine required environment names plus `PORT=43552`, `HOSTNAME=127.0.0.1`, `OPENCUT_PUBLIC_BASE=/`, `OPENCUT_NEXT_DIST_DIR=.next`, `C4_BUILD_MARKER`, and `NEXT_TELEMETRY_DISABLED`.
- Owned Next PID 65652 was the sole 43552 listener. Next 16.1.3 reported ready in 275ms. `GET /projects` returned HTTP 200 and 29,856 bytes at `2026-08-02T16:27:33.4351831+08:00`.
- Authoritative command from `apps/vite-example`: `bun run test:parity` with `PARITY_HOST=next`, `PARITY_BASE_URL=http://127.0.0.1:43552/`, `PARITY_NO_WEBSERVER=1`, and `OPENCUT_PUBLIC_BASE=/`.
- Start/end: `2026-08-02T16:27:42.8246621+08:00` / `2026-08-02T16:28:40.4214385+08:00`; exit 0; 1/1 passed in 55.4s (test 51.3s).
- PID 65652 was stopped directly; port 43552 was clear at `2026-08-02T16:28:56.4065588+08:00`.

Each ledger contains exactly the ten required interactions (`create-open`, `import-media`, `place-multi-track`, `drag`, `trim`, `split`, `snap`, `scrub`, `play`, `save-reload-reopen`) and every `error` is null. Vite blocked no third-party request and logged no console error. Next blocked `https://cdn.databuddy.cc/databuddy.js` and recorded two corresponding `net::ERR_FAILED` console lines. Each isolated Playwright context persisted only its fixture's project/media/library databases; no user Chrome profile was used.

## Blocking protected diff

Exact command from the product root:

```text
node script/diff-parity-snapshots.mjs apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json apps/vite-example/tests/parity-artifacts/next/snapshot-next.json E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rasen/changes/s02-storage-port/evidence/parity-final-diff.md
```

Start/end: `2026-08-02T16:29:08.7842740+08:00` / `2026-08-02T16:29:08.9538001+08:00`; exit **1**.

| Measurement            | Required |  Actual |
| ---------------------- | -------: | ------: |
| leaf values            |      195 | **408** |
| semantic differences   |        0 |  **12** |
| incidental differences |        9 |  **15** |

The 12 semantic paths are eight random private attachment identifiers (`media[0..3].__opencutAttachmentStore.{bodyKey,mutationId}`) plus four values duplicated inside `project.__opencutProjectStore` (record metadata name, record timeline playhead, record timeline zoom, and summary name). The six extra incidental paths are the private project-envelope copies of duration and the five one-frame placement/trim fields; the original nine incidental paths remain present.

Read-only source tracing explains the mismatch without changing the protected harness:

- `browser-project-store-records.ts` spreads the compatibility project payload and also embeds the complete record/summary under `__opencutProjectStore`; attachment rows likewise include compatibility metadata plus `__opencutAttachmentStore`.
- `browser-project-store-internals.ts` creates body and mutation keys as a fixed `.c5-*` prefix plus a random UUID.
- the protected `tests/parity/snapshot.ts` intentionally reads raw IndexedDB rows. Its unchanged normalizer masks bare UUID values and named ID fields, but a prefixed random UUID is neither; it also preserves the new private envelopes.
- therefore the protected snapshots now contain a second project representation and four pairs of nondeterministic attachment identifiers. The fail-safe oracle correctly treats the unrecognized paths as semantic.

The parity report is `evidence/parity-final-diff.md`, SHA-256 `23640CD89C6E1BF006FD97099203E8C3CACA2ED524502A1552997592F0A2BFED`. Snapshot SHA-256 values are Vite `B76EEAC2A0B3312E21692C939BEE445AFB164DF99978DF8A1E56FB8E985D3AD0` and Next `3A92B46EF446883236C9F6F946185BA3B7E3B9A98CF2015D7614B4D2A7C47B2F`.

## 11.6 protected integrity

All commands ran from the product root and exited 0:

```text
git status --short --untracked-files=all -- apps/vite-example/tests/parity script/diff-parity-snapshots.mjs
git diff --exit-code 0ef35459f685d5d41a25d0ef959aff691b7519cd -- apps/vite-example/tests/parity script/diff-parity-snapshots.mjs
git rev-parse 0ef35459f685d5d41a25d0ef959aff691b7519cd:apps/vite-example/tests/parity
git rev-parse 0ef35459f685d5d41a25d0ef959aff691b7519cd:script/diff-parity-snapshots.mjs
git hash-object --path=script/diff-parity-snapshots.mjs script/diff-parity-snapshots.mjs
```

There was no protected tracked or untracked status and the content diff was empty. Identities matched the required parity tree `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` and oracle blob `fa387ebea1e7f0cc1110eebcb922d393a1337842` exactly.

## Evidence/output and cleanup ledger at hard stop

- `apps/vite-example/tests/parity-artifacts`: retained for diagnosis, 28 files / 1,314,967 bytes. Each Host directory has 13 files (11 screenshots, ledger, snapshot), plus two Playwright JSON result files at the artifact root.
- Vite snapshot SHA-256: `B76EEAC2A0B3312E21692C939BEE445AFB164DF99978DF8A1E56FB8E985D3AD0`; Next snapshot SHA-256: `3A92B46EF446883236C9F6F946185BA3B7E3B9A98CF2015D7614B4D2A7C47B2F`.
- `apps/vite-example/dist-c5-final-20260802-155342` and `apps/web/.next` (including the bounded standalone assembly) are intentionally retained because the gate failed and a reproducer needs the exact consumed outputs.
- Raw logs remain under `.rasen/changes/s02-storage-port/ephemera/final-20260802-155342/`: `phase-b-vite-preview.*`, `phase-b-parity-vite-attempt2.log`, `phase-b-next-standalone.*`, and `phase-b-parity-next.log`.
- The parity-created one-file `.pw-output` was moved intact to ephemera as `phase-b-parity-pw-output-run`; the pre-existing empty `.pw-output` directory was restored exactly and its temporary backup name is absent.
- Ports 4175, 4177, 43551, and 43552 are clear. Zero task-owned Bun, Node, Vite, Chrome/Chromium, or Next process refers to the product worktree.
- No source intent-to-add was applied, no source/SBOM generator ran, and no run-owned build/parity output was staged.
- Final porcelain status has 423 lines: 307 are the retained run-owned Vite output and the remaining **116 candidate-source paths** are the unchanged C5 set (52 tracked entries plus 64 ordinary untracked paths). The index has 0 cached paths and 0 intent-to-add entries.

Final status for this run: **BLOCKED at task 11.5; task 11.6 PASS; tasks 11.7-11.12 unexecuted.**

## Superseding Phase-7 accepted-fix tail

Run id: `final-20260804-lunamax-p7-01`  
Execution window: 2026-08-04 (+08:00)  
Product cwd: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch/HEAD/tree: `feat/s02-storage-port` / `0ef35459f685d5d41a25d0ef959aff691b7519cd` / `286272307b05d23826ffa7223a76695365194dba`

The blocked Phase-B record above is retained as history. The Phase-7 run
reproduced its protected inputs, applied only the accepted-fix sidecar changes,
and reran the downstream gates. This section supersedes the old `UNEXECUTED`
claims for this run; it does not alter the protected parity fixture, oracle,
task/run-state files, or the separate implementer-evaluation file.

| Gate                                                     | Result                       | Evidence                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh Vite build, distributable boundary, preview/parity | PASS                         | Vite 7.3.6, 2,887 transformed modules; distributable boundary 10/10 exclusions; owned preview on 43551; parity 1/1.                                                                                                                                                |
| Fresh Next build, standalone preview/parity              | PASS                         | Next 16.1.3, 18/18 static pages; owned standalone on 43552; parity 1/1.                                                                                                                                                                                            |
| Protected parity oracle                                  | PASS                         | Exact **195 leaves, 0 semantic, 9 incidental**, every row `error:null`; report `evidence/parity-final-diff.md`.                                                                                                                                                    |
| Emitted runtime-asset inventory                          | PASS                         | Positive controls (mounted and root-base Vite/Next) and all **25** negative controls pass (23 existing plus two mounted-base dot-segment fixtures); real Vite/Next inventories written to `ephemera/final-20260804-lunamax-p7-01/emitted-inventory-final-m1.json`. |
| Focused C5 group                                         | PASS                         | 64 tests / 241 expectations across 15 files.                                                                                                                                                                                                                       |
| Storage, type, WASM, and boundary gates                  | PASS                         | Storage boundary; exact three-diagnostic type baseline; WASM export/import/API/runtime gates with **14 API negative controls**; port, Host, and session-state negative controls.                                                                                   |
| Isolated topology controls                               | PASS                         | Browser-project 12/12, media 7/7, cascade 7/7, migration child 9/9 (37 expectations).                                                                                                                                                                              |
| Provenance and strict validation                         | PASS                         | Source inventory/SBOM/reference-boundary generators; `rasen validate ... --strict --json` 1/1, zero issues.                                                                                                                                                        |
| Final unfiltered Bun regression                          | ACCEPTED INHERITED REDS ONLY | **330 pass / 8 fail / 2 loader errors / 1,058 expectations** (338 tests, 64 files). The eight failures are the six inherited `ZERO_MEDIA_TIME` identities plus the inherited WASM `__wbindgen_start` and `DEFAULTS` loader errors; no new Phase-7 failure remains. |

The first Phase-7 full-suite attempts exposed an order-sensitive migration
topology test (and one transient media-worker crash). The migration test was
made process-isolated using the repository's existing Bun child-process
pattern; sequential migration/media/cascade/topology combinations and the
isolated child run then passed. Full-regression stdout/stderr, rerun, fixed
rerun, and topology logs are preserved under
`rasen/changes/s02-storage-port/ephemera/final-20260804-lunamax-p7-01/`.

No independent review or ship decision is claimed by this author evidence.

## Post-return format-gate correction

The first Phase-7 return omitted an explicit Prettier gate. LEAD completeness review reran
`bun x prettier --check` on the three authored files and found both modified boundary scripts
unformatted (the migration-topology test already matched). Luna then ran Prettier write only on
`script/check-runtime-asset-boundary.mjs` and `script/check-emitted-runtime-assets.mjs`. The final
three-file Prettier check passed. ESLint over the same files exited 0 (repository pages-directory
warning only), and `git -c core.whitespace=cr-at-eol diff --check` passed.

Post-correction source positive/negative controls and the sensitive deleted-file RED test passed
(1/1, 4 expectations). Emitted positive control passed; all **25/25** negative fixtures passed
(23 existing plus the literal and encoded mounted-base dot-segment fixtures);
the preserved Phase-7 outputs passed real inventory with Vite layers `1/1/1/1` and Next layers
`9/3/1/1`. The rerun inventory is retained at
`ephemera/final-20260804-lunamax-p7-01/emitted-inventory-final-prettier.json` and its normalized
host/base/count/topology summary matches the original final inventory.

Migration topology reruns remained clean in wrapper mode (1 test), explicit child mode (9 tests / 37
expectations), and migration+media (8/74), migration+cascade (8/48), and migration+physical-topology
(13/64) two-file combinations. Exact-three type baseline passed; no owned process or listener
remained on ports 43551/43552. This correction is formatting/evidence completeness only and does
not change the accepted inherited-red disposition above.

## Post-Sol M1 mounted-base correction

Sol identified a fail-open raw-prefix case for literal and encoded dot segments. The emitted checker
now canonicalizes mounted candidates with WHATWG `URL`, rejects origin changes, and applies mount
containment to the canonical pathname. Named fixtures `vite-mounted-dot-segment-literal` and
`vite-mounted-dot-segment-encoded` are guarded by a dedicated Bun RED test; both exit 1 with
`root-emitted-entry-url`, the entry file attribution, and their exact URL. The final emitted gate is
**25/25** negative fixtures (23 existing + 2 M1), with positive control and preserved-output
inventory still green at Vite `1/1/1/1` and Next `9/3/1/1`.

## Post-Sol provenance/index correction (B1)

The exact intentional untracked-source list is recorded in `final-parity-sidecar-protected-tail.md` (36 omitted C5 paths, 30 additional C5 harness/fixture paths, and the M1 RED test). Outputs/cache/parity/profile/database/generated/evidence paths were rejected. `git add -N` was applied only to those 67 exact source paths; `git diff --cached --name-status` remained empty and the index had no cached content or prohibited path.

Canonical outputs are now reconciled: source inventory **1069 files / 7,500,075 bytes / rollup `8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf`** with drift **169 modified / 97 added / 0 other**; SBOM generator output **1359 npm / 80 wasm** with frozen-base identity **1359 npm / 763 workspace-lock Rust / 80 wasm32**; reference boundary **969/1640 scanned, clean**. The generator's one inherited `workers` observation was recorded and removed as a one-line `apply_patch` repair. The final diff against HEAD `0ef35459f685d5d41a25d0ef959aff691b7519cd` for `LICENSE`, `REFERENCE_SOURCES.md`, `UPSTREAM.md`, `bun.lock`, `Cargo.lock`, and `SBOM.md` is empty. `PATCHES.md` reconciles exactly at **177 changed inherited paths / 177 unique rows**.

## Post-review residual C5-P7-m2 correction chronology

Fresh Sol re-review caught stale current evidence claims and two peer-artifact format failures: the WASM API negative control is **14 PASS controls**, the reference-boundary scan is **969/1640**, and the rerun full Bun result is **330 pass / 8 fail / 2 loader errors / 1,058 expectations** over **338 tests / 64 files**. The unchanged inherited red multiset is six `ZERO_MEDIA_TIME` placement failures plus the `wasm.__wbindgen_start` and `DEFAULTS` loader errors. The stale claims and format failures were residual re-review findings, not first-pass successes; the three author artifacts were then formatted and rechecked.
