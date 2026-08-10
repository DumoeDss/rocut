# Spec-falsification sweep — `s0304-surface-embedding-contract-freeze`

**Recovery date:** 2026-08-10  
**Result:** Zero assertions falsified.

## Method and source coverage

The recovery reran the requested case-insensitive search for
`EditorRoot|EditorSurface|surface|focus|mount|suspend|CSS|body|:root` over every
current `rasen/specs/**/*.md` file. The current integrated tree contains 13
capability specs; the exact original base-plus-R0 tree
`3e1cce7fc0e95e4221d1911b558167408198378a` contains 12. Neither rerun found an
assertion contradicted by the recovered R0 types.

The original implementation context contained 15 specs. Static transcript
record 117 shows that `next-free-distributable-boundary`,
`editing-parity-fixture`, and `inherited-defect-repair` were concurrent,
untracked spec directories rather than members of the original base tree.
Records 199–202 preserve the original 15-spec glob and complete keyword search;
records 205–210 preserve the three specifically requested reads. These records
were parsed as static JSONL only. No transcript command or Claude runtime was
invoked.

Preserved transcript:
`C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-elftia-elftia-elftia/432c1542-4f82-4b60-9f4f-9661c69cec61/subagents/agent-aimpl-r0-58df05918476176e.jsonl`
(SHA-256 `91f8ea369248762d126e5054242d3cf607e1cac1bec57bd002e2efdcde4bd846`).

## Specifically requested checks

### `editor-session-runtime`

R0 consumes the lifecycle and does not redefine it.

- The spec requires `mount`, `suspend`, `resume`, `unmount`, and `dispose` with
  defined ordering. `SurfaceLifecycleBinding` maps exactly to those calls.
- The spec distinguishes suspend/resume from unmount. R0 preserves that
  distinction and records reversible unmount separately from irreversible,
  host-driven disposal.
- The spec requires `mount` to return a root handle before readiness. R0 records
  synchronous handle storage followed by awaiting `handle.ready`.
- The `EditorSessionProvider` requirement is not displaced: R0 declares an
  embedding contract and implements no React root or provider wiring.

No assertion is falsified.

### `host-service-boundary`

The spec contains no transaction commit-seam requirement. It governs
host-supplied server endpoints, port roles, visible degradation, and handling
records. R0 neither changes the Host port surface nor adds a Host service;
`SurfaceCommitBinding` is an optional Surface-local opaque slot with
`commit({ edit: unknown })`.

No assertion is falsified.

### `next-free-distributable-boundary`

The spec is no longer present in the current main-spec set, so the recovery used
the preserved read at transcript records 209–210:

- Lines 46–54 require the editor to size to its parent rather than claim the
  viewport. R0 states that the Surface fills its container, not the viewport.
- Lines 56–60 require the portalled-overlay containment deviation to be
  recorded. R0's design records the Radix `document.body` portal limitation.
- Lines 62–69 prohibit non-editor product code in the distributable graph. R0
  adds only editor-local types and no runtime wiring.

No assertion is falsified.

## Remaining original specs

- `editing-parity-fixture`: the exact historical R0 tree passed both Host
  scenarios and reproduced the committed classification of 9 incidental and 0
  semantic differences across 195 leaf values.
- `headless-editing`: the new module is not imported by the headless graph and
  adds no React runtime code.
- `session-resource-disposal` and `session-state-isolation`: R0 maps to the
  frozen session methods and does not alter state/resource ownership.
- `runtime-asset-delivery`, `browser-persistence-boundary`,
  `host-port-contract`, `developer-reproducibility`,
  `self-built-wasm-artifact`, `upstream-provenance`, and `wasm-api-surface`:
  R0 introduces no asset, persistence, Host-port, WASM, or provenance behavior.
- `inherited-defect-repair`: R0 changes no pre-existing product body.

## Finding

No existing capability assertion is falsified by the recovered R0 contract.
The difference between the historical 15-spec set, the exact Git base's
12-spec set, and the current 13-spec set is a provenance limitation caused by
concurrent/untracked and later-synced planning state; it is not an R0 product
finding.
