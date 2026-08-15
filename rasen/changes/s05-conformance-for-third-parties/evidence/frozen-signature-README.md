# Frozen-signature control (task 7.2)

Method: P2's procedure (`rasen/changes/archive/2026-08-14-s05-second-host/evidence/frozen-signature/README.md`),
which is P1's premove-baseline `frozen-signature-*.diff` procedure with this change's base in
place of P1's move base. Stat-cache-immune per the standing git lesson: `git show` of the base
blob piped to `cmp` against the working-tree file — `git diff` alone can report clean when
bytes diverge.

Base commit: `8248a115` ("chore(rasen): archive s05-second-host") — the parent of this change's
first commit `7e2f429d`.

```sh
git show 8248a115:<path> > /tmp/fs-base.tmp
cmp -s /tmp/fs-base.tmp <path>   # exit 0 = byte-identical
```

Results, all four surfaces frozen by S03+S04 (path list verbatim from P1's task 8.7 record,
as P2 carried it):

| Frozen surface | Path | Result |
|---|---|---|
| Transaction contract barrel | `packages/editor-classic/src/editor/transactions/opencut/index.ts` | IDENTICAL |
| Engine | `packages/editor-contracts/src/engine/engine.ts` | IDENTICAL |
| Ports barrel | `packages/editor-ports/src/index.ts` | IDENTICAL |
| Surface embedding types | `packages/editor-classic/src/editor/surface/embedding/types.ts` | IDENTICAL |

Zero differences. No frozen public signature changed anywhere in this change; the `failed`
condition ("pressure to change one") never arose and nothing was escalated. No diff artifacts
are committed alongside this README because there are no diffs to show.

The five conformance suite modules are diff-empty over the whole change
(`git diff --stat 8248a115..HEAD -- <the five paths>` produced no output):

- `packages/editor-ports/src/conformance/index.ts`
- `packages/editor-contracts/src/conformance/index.ts`
- `packages/editor-contracts/src/engine/conformance/index.ts`
- `packages/editor-contracts/src/draft/conformance/index.ts`
- `packages/editor-contracts/src/vectors/runner.ts`

The legibility layer (requirement indices, formatters) sits BESIDE the suites as new files;
the suites themselves are untouched.

Independent corroboration: `check-port-boundary.mjs` (which pins the frozen port-contract
signature directly) ran green in this group's sweep (`logs/group7-all-checkers.log`).
