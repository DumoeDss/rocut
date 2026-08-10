# Ship Log: s0304-surface-embedding-contract-freeze

**Date:** 2026-08-10T20:43:29+08:00
**Mode:** local
**Branch:** recovery/s0304-ui-commit-routing-final
**Commit:** 11dd2cb4b29b8bf1b7efa7c3e87c013a6a85b8ff
**Tree:** 94e61eeb3de364c6cb016f5fbf1842a69fd8dc12
**Parent:** 95cb64538e12a6d35675af50fb0de5766e12c4a5
**Status:** Committed (delivery deferred to portfolio/parent level)

The commit above is a new synthetic recovery delivery identity. It does not
recreate or replace lost historical product commit `fab202d4` or lost archive
commit `e94ea055`. This log is carried in a separate local evidence commit so
the delivery commit and tree remain immutable; the evidence commit identity is
reported from Git after that commit is created, because embedding its own SHA
in this file would be self-referential.

## Delivered paths

- Two exact product files under
  `apps/web/src/editor/surface/embedding/**`.
- Ten planning and pre-ship evidence files under
  `rasen/changes/s0304-surface-embedding-contract-freeze/**`.
- No `.rasen/**` run-state file or unrelated path was staged, cleaned, or
  committed.

## Product identity

| Path | SHA-256 | Git blob |
| --- | --- | --- |
| `apps/web/src/editor/surface/embedding/types.ts` | `191d8ce880dc4807c90f8ff9113333c4e6992d1e4274bcc756a62a6cad3d5379` | `5bbfc48d3a1dc0af71275ce1dccad71df0f2d167` |
| `apps/web/src/editor/surface/embedding/index.ts` | `81a514fa12be1e5d19d25d816f13de3a9122de61771df1de0c1abe6c844cb313` | `bfbf6f6fdb54813d5c9d252cbb5bdc0ca385e57a` |

The historical base-plus-two-files tree proof remains
`3e1cce7fc0e95e4221d1911b558167408198378a`. It is provenance evidence for the
original base `d84d9d50b718aa3c85c76ec762febcb5db0286ff`; it is not the current delivery
tree, and the live branch was never reset to it.

## Pre-Flight Results

- Pipeline: `rasen pipeline resume s0304-surface-embedding-contract-freeze --project rocut --json` reported `next=ship`, no open findings, and ship ready.
- Tasks: 15/15 complete; 0 remaining.
- Verification: independent review passed with 0 Blocker, 0 Major, 0 Minor,
  and one accepted-known Trivial item.
- Base identity: branch, parent commit, and parent tree
  `fdcbe1420428adecfc30cb37b8b65a9e9fcf08dc` matched the expected recovery
  baseline before staging.
- Staging: exactly 12 authorized R0 paths; staged delivery tree
  `94e61eeb3de364c6cb016f5fbf1842a69fd8dc12`.

## Test Gate

- Required scope: strict Rasen artifact validation; pinned Web type baseline;
  Vite Host typecheck; focused ESLint and product diff/identity checks for the
  two additive declaration files.
- Rationale: R0 adds an otherwise unconsumed type-only module and planning
  evidence. It adds no component body, runtime import edge, CSS, event handler,
  persistence, dependency, build configuration, or executable path. The
  focused type and lint gates cover the delivered product risk. Broader current
  Next/Vite builds and historical-tree parity remain green in
  `review-report.md`, but were not misrepresented as tree-matched ship gates.
- `rasen validate s0304-surface-embedding-contract-freeze --strict --project rocut --json`: PASS — 1 passed, 0 failed, no issues.
- `node script/check-type-baseline.mjs`: PASS — 3 current diagnostics, 13 at
  pin `cf5e79e9`, no diagnostic outside the pinned baseline.
- `bun x tsc --noEmit -p apps/vite-example/tsconfig.json --pretty false`: PASS
  — 0 diagnostics.
- `bun x eslint apps/web/src/editor/surface/embedding/types.ts apps/web/src/editor/surface/embedding/index.ts`: PASS — 0 errors, 1 accepted-known warning.
- Product-scoped `git diff --cached --check`: PASS.
- Strict UTF-8 check over all 12 delivery paths: PASS — no invalid sequence,
  BOM, U+FFFD, or CRLF; every file retains a final LF.
- Product identity after staging and after delivery commit: PASS — both SHA-256
  values and Git blobs match the preserved transcript payloads.
- Structural scan: PASS — no TODO/FIXME/HACK, debug output, or secret marker in
  the product files.
- Gate tree: `94e61eeb3de364c6cb016f5fbf1842a69fd8dc12`.

### Accepted-known item

Focused ESLint reports one `@typescript-eslint/no-unused-vars` warning for the
type-only `EditorSessionRootHandle` import in `types.ts`. It emits no runtime
dependency and is retained to preserve the required exact SHA-256, Git blob,
and historical tree proof. Product bytes were not changed to remove it.

The complete staged whitespace check also identifies intentional two-space
Markdown hard breaks in three evidence reports. The product-scoped strict diff
check is clean; no product or planning-contract byte was rewritten during ship.

## Delivery and archive facts

- Push: not run.
- Pull request: not created.
- Archive: not run; the active change was not moved or deleted.
- Archive timing: `on-merge`, as resolved from
  `rasen status --change s0304-surface-embedding-contract-freeze --project rocut --json`.
- Local mode has no merge event. Retention and any later archive action remain
  the responsibility of the portfolio/parent workflow after local delivery.
- LEAD-owned `.rasen/changes/**/ephemera/auto-run.json` and
  `portfolio-run.json` were not edited.
