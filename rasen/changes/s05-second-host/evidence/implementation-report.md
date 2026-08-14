# s05-second-host — implementation report

Implementer: `implementer-s05-p2`. Change: `s05-second-host` (P2 of the S05
`community-beta-second-host` portfolio), branch `feat/s05-community-beta`, local
commits only. Written as groups complete; oracle verdicts and exit codes live in
the named evidence files beside this one.

## Environment rulings made before any Host source existed

- **Registry concurrency stall (durable finding).** `bun install` on this
  machine hung indefinitely at `Resolving dependencies` with ~0 CPU. `--verbose`
  showed the true state: `waiting for 87 tasks` — bun's pool of concurrent
  registry manifest fetches never completing. Single registry requests complete
  fine (`bun pm view electron version` returns in seconds); only the concurrent
  burst stalls. This is a network throttling signature, not a tooling bug and
  not the AV `%TEMP%` signature the dispatch warned about (TMP/TEMP were already
  redirected to an E: drive before the first attempt; the stall happened before
  any download staging began). The bisect evidence: with all of this change's
  manifest edits neutralized, `bun install --dry-run` still hung; a scratch
  project installed in 24 ms; `--frozen-lockfile --dry-run` also hung (bun
  re-resolves subtrees affected by any manifest delta, enqueueing 87 manifest
  downloads). Remedy: `BUN_CONFIG_MAX_HTTP_REQUESTS=6` on the install
  invocation. Transcript: `evidence/logs/gate-1-install.log` and
  `evidence/logs/gate-1-diagnostic-dryrun.txt`.
- **Type-baseline is red at the live baseline — pre-existing, named cause.**
  `script/check-type-baseline.mjs` exits 1 at branch HEAD before any of this
  change's edits, failing on exactly two diagnostics:
  `packages/editor-classic/src/timeline/__tests__/update-pipeline.test.ts:69` and
  `.../placement/__tests__/resolve.test.ts:646` (TS2769, number vs MediaTime).
  Cause: commit `c234042e` (S05-P1 "extract Stage C") moved both files out of
  `apps/web/src/timeline/...` into `packages/editor-classic`, shifting their
  pinned path keys: the pin (cf5e79e9) knows these diagnostics under their old
  `src/...` keys, so they register as "not present at the pin". Red has been the
  state of this checker on this branch since that commit. This change's duty
  (tasks 3.6 / 9.3) is that the checker is **unchanged** from the 2.1 baseline
  capture — which stays a byte-identical comparison whether green or red.
  Baseline capture: `evidence/census/baseline-type-baseline.txt`
  (REAL_EXIT_CODE:1 recorded).

## Group 1 — gate: prove the desktop substrate

In progress. Install transcript with REAL_EXIT_CODE: `evidence/logs/gate-1-install.log`.

## Group 2 — oracle first: boundary checker sees a third consumer

Baseline census captured before any checker edit or Host source (2026-08-15):

| measure | value |
| --- | --- |
| repo files scanned (no-elftia-import) | 1051 |
| acyclic-direction files / edges | 964 / 329 |
| public-entry-only files / specifiers | 964 / 328 |
| no-internal-reexport files | 863 |
| react-free-base files | 68 |
| negative control | clean, REAL_EXIT_CODE 0 |
| converse control | clean, REAL_EXIT_CODE 0 |
| type-baseline | RED, pre-existing (see above) |

Transcripts: `evidence/census/baseline-*.txt`.

Note: 1051/964/329/328/863 match the P1-close figures the handoff recorded; the
handoff's no-elftia figure (1048) has drifted +3 with unrelated tree growth —
recaptured live here, as the design's Context section instructed.
