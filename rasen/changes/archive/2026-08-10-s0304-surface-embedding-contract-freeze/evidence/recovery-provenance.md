# Recovery provenance — `s0304-surface-embedding-contract-freeze`

## Recovery scope

This report records the synthetic recovery of the original R0 propose-stage planning artifacts. The recovery restores the four planner-authored artifact bodies only. It does not recreate the original commit, Git object, branch, archive entry, archive timestamp, filesystem metadata, or any other historical identity.

The synthetic `.openspec.yaml`, `README.md`, and this provenance report are recovery scaffolding/evidence, not claimed historical artifacts. No product source or LEAD run-state file was recovered or edited by this stage.

## Preserved source

- Transcript: `C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-elftia-elftia-elftia/432c1542-4f82-4b60-9f4f-9661c69cec61/subagents/agent-aplanner-r0-cfeb89a4d7cee0b6.jsonl`
- Transcript SHA-256: `80a85a94be0d474f1ebe1d72db40421387bd3936a10fcb7f7bdca109c4f36233`
- Interpretation: one-based JSONL record positions; artifact bodies were extracted only from the named `Write` tool call's `input.content`. The immediately following `tool_result` records confirm that the original tool reported each file created successfully.
- Runtime boundary: the transcript was parsed as static JSONL. No Claude Code command, Claude runtime, or transcript-contained command was invoked during recovery.

## Artifact provenance

| Recovered artifact | `Write` record / UUID / tool-use id | Success-result record / UUID | SHA-256 | Strength |
| --- | --- | --- | --- | --- |
| `proposal.md` | 43 / `06734e5d-54dd-495b-adde-6fb05985a35d` / `call_86ff1abef31e4e188645ec8e` | 44 / `73fa37f5-f97f-408d-8a42-9a7d66dbeece` | `8f389e31a24aa26619745de0e3f2d6c918626ac3d8a4d52663e5099784ee07fb` | Strong: transcript-exact body |
| `design.md` | 55 / `18443203-46c7-46de-af76-3f5961260300` / `call_1fd3148e1fcb48c3a942d1fa` | 56 / `904a0fa1-6e6f-4b1c-8656-ae90e3f97e25` | `bf14db11d4548c22a293857d1defafbf4bd959e4d468fdd9a88062ebbcff0b65` | Strong: transcript-exact body |
| `specs/embeddable-react-surface/spec.md` | 57 / `65416366-e5d0-4350-898a-60fdec78be23` / `call_cf87d3e6bd6c4ad2bfed8bb3` | 58 / `1b376470-baf0-49de-a5c5-b7023b28d81a` | `6616ad46a7b0c3656e536925d227f94db0f73f9fa16eacf7d98f29ea0f1a529c` | Strong: transcript-exact body |
| `tasks.md` | 67 / `5d5457fd-06e6-4cc3-9056-2773b7c858a4` / `call_08515bb58c3b463fb1976198` | 68 / `636fe8d4-0127-46f7-b1c3-57d22ddef621` | `7b0dc0bf2cd63f1d64fff22d7d670929c38c327d7cc4c1c7613999a6ba2146b4` | Strong: transcript-exact body |

For each artifact, the current file is UTF-8 without BOM, uses LF line endings, includes the evidenced final LF, and hashes identically to the UTF-8 bytes of the preserved `Write.input.content` string.

## Contract and workflow checks

- A1 remains frozen as an opaque R0 `SurfaceCommitBinding` whose implementation task exposes `commit(args: { edit: unknown }): void`; the restored artifacts import or name no T0 transaction/domain type in that public slot.
- A2 remains assigned to R2 as shared React 18; R0 does not re-decide or implement the React strategy.
- R0 remains additive-only under `apps/web/src/editor/surface/embedding/**` and wires nothing.
- `specs/embeddable-react-surface/spec.md` contains 9 requirements and 24 scenarios.
- `tasks.md` contains 15 tasks: 0 checked and 15 unchecked. Recovery did not implement or tick tasks.
- Current validation command: `rasen validate s0304-surface-embedding-contract-freeze --strict --project rocut --json`.
- Current validation result: valid `true`, 1 passed, 0 failed, no issues (2026-08-10 recovery run).

## Limitations

The preserved source establishes the exact artifact content strings submitted to the original `Write` tool and records successful tool results. It does not independently preserve the original filesystem bytes after subsequent processes, original file timestamps, original Git tree/blob/commit identifiers, or an archive identity. Therefore “transcript-exact body” is claimed; original repository identity is not.

The historical transcript also records an all-change strict validation attempt at records 74–75: the overall command exited nonzero because other changes were invalid, while this R0 change was shown as valid. The current single-change JSON validation above is the authoritative recovery check.

## Product implementation recovery (R0 apply stage, 2026-08-10)

### Preserved product source

- Transcript: `C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-elftia-elftia-elftia/432c1542-4f82-4b60-9f4f-9661c69cec61/subagents/agent-aimpl-r0-58df05918476176e.jsonl`
- Transcript SHA-256: `91f8ea369248762d126e5054242d3cf607e1cac1bec57bd002e2efdcde4bd846`
- Interpretation: one-based JSONL record positions. Only the named `Write.input.content` payloads were recovered as product source. The transcript was parsed as strict UTF-8 static JSONL; no Claude Code command, Claude runtime, or transcript-contained command was invoked.

| Product path | `Write` record / UUID / tool-use id | Success-result record / UUID | UTF-8 bytes | SHA-256 | Git blob |
| --- | --- | --- | ---: | --- | --- |
| `apps/web/src/editor/surface/embedding/types.ts` | 79 / `56960893-660c-4580-b9c1-8ce7b7eafbb2` / `call_c6e7994cb0664052a2abc222` | 80 / `ccf4a251-b8ed-44e4-a901-9324dd085c32` | 12,969 | `191d8ce880dc4807c90f8ff9113333c4e6992d1e4274bcc756a62a6cad3d5379` | `5bbfc48d3a1dc0af71275ce1dccad71df0f2d167` |
| `apps/web/src/editor/surface/embedding/index.ts` | 83 / `c561ab70-a9b5-438b-8253-d4d6acba6948` / `call_35961306aeac4d359db7e251` | 84 / `998ca2d2-9d95-4b1d-84c4-2b16e642efb6` | 419 | `81a514fa12be1e5d19d25d816f13de3a9122de61771df1de0c1abe6c844cb313` | `bfbf6f6fdb54813d5c9d252cbb5bdc0ca385e57a` |

The current files match both payload SHA-256 values and both Git blob ids after checkout. They retain the evidenced final LF and were not formatted or otherwise rewritten.

### Original-base tree proof

The implementation transcript explicitly supports the base rather than requiring a portfolio-only inference:

- record 52 created the original implementation branch from `d84d9d50`;
- record 241 showed the original implementation commit immediately above `d84d9d50`;
- record 246 summarized that the implementation branch was based on the S02 tip `d84d9d50`.

Resolved identities:

- base commit: `d84d9d50b718aa3c85c76ec762febcb5db0286ff`
- base tree: `3d7c5e3a76db7665f5571723f72e40d2388c88ce`
- expected reconstructed tree: `3e1cce7fc0e95e4221d1911b558167408198378a`

Exact Git plumbing commands (with a temporary index outside the repository index):

```text
GIT_INDEX_FILE=<temp> git read-tree d84d9d50^{tree}
GIT_INDEX_FILE=<temp> git update-index --add --cacheinfo 100644,5bbfc48d3a1dc0af71275ce1dccad71df0f2d167,apps/web/src/editor/surface/embedding/types.ts
GIT_INDEX_FILE=<temp> git update-index --add --cacheinfo 100644,bfbf6f6fdb54813d5c9d252cbb5bdc0ca385e57a,apps/web/src/editor/surface/embedding/index.ts
GIT_INDEX_FILE=<temp> git write-tree
```

`git write-tree` returned exactly
`3e1cce7fc0e95e4221d1911b558167408198378a`. `git diff --cached --name-status d84d9d50` under that temporary index reported only:

```text
A  apps/web/src/editor/surface/embedding/index.ts
A  apps/web/src/editor/surface/embedding/types.ts
```

The live repository index SHA-256 was
`7c4ba0c82f16d54102af5d884a056effa1797a45b7b261e6c83de9dfe3e9dfbf`
both before and after the reconstruction. No branch or ref was changed.

### Apply and verification result

- All 15 tasks are checked; `rasen instructions apply ... --project rocut --json` reports `all_done`, 15 complete, 0 remaining.
- `rasen validate s0304-surface-embedding-contract-freeze --strict --project rocut --json` reports 1 passed, 0 failed, no issues.
- Current integrated Next and Vite builds pass. Focused TypeScript passes with zero R0 diagnostics, and focused ESLint has zero errors (one transcript-exact unused-import warning).
- Both Hosts pass the parity scenario in the exact reconstructed historical tree. Snapshot comparison reproduces the committed baseline: 9 incidental, 0 semantic differences across 195 leaf values.
- The spec-falsification evidence records zero falsified assertions.

### Exact-versus-synthetic limitations

The two product files are byte-exact payload recoveries with matching Git blob identities, and the reconstructed base-plus-files Git tree is exact. This does not recreate the original implementation commit `fab202d4`, its ref, author/committer metadata, timestamps, filesystem metadata, or archived change identity. The current checkout remains an integrated recovery branch at `95cb64538e12a6d35675af50fb0de5766e12c4a5`.

Task checkbox updates, `implementation-report.md`, `spec-falsification-sweep.md`, and this appended section are synthetic recovery workflow/evidence authored on 2026-08-10; they are not claimed as transcript-exact historical files. The original 15-spec set also included three concurrent untracked spec directories absent from the exact base, so their original sweep is supported by static transcript records 117 and 199–210 rather than current filesystem identity.
