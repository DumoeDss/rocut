# Frozen-signature control (task 9.4)

Method: P1's premove-baseline `frozen-signature-*.diff` procedure
(`rasen/changes/archive/2026-08-14-s05-package-extraction/evidence/premove-baseline/`),
with this change's base commit in place of P1's move base. P1 diffed each
frozen surface against `8437084b` because P1 **moved** the four files (its
diffs contain import-specifier rewrites). This change moved nothing, so the
bar here is stricter: **zero differences**, byte-for-byte.

Base commit: `66add22f` ("chore(rasen): archive s05-package-extraction") —
the parent of this change's first commit `8d3de9c6`, i.e. the branch point of
`feat/s05-community-beta` before any s05-second-host work.

Procedure (stat-cache-immune per the standing git lesson — `git diff` alone
can report clean when bytes diverge, so the comparison is `git show` of the
base blob piped to `cmp` against the working-tree file):

```sh
git show 66add22f:<path> > /tmp/fs-base.tmp
cmp -s /tmp/fs-base.tmp <path>   # exit 0 = byte-identical
```

Results, all four surfaces frozen by S03+S04 (path list taken verbatim from
P1's task 8.7 completion record):

| Frozen surface | Path | Result |
|---|---|---|
| Transaction contract barrel | `packages/editor-classic/src/editor/transactions/opencut/index.ts` | IDENTICAL |
| Engine | `packages/editor-contracts/src/engine/engine.ts` | IDENTICAL |
| Ports barrel | `packages/editor-ports/src/index.ts` | IDENTICAL |
| Surface embedding types | `packages/editor-classic/src/editor/surface/embedding/types.ts` | IDENTICAL |

Zero differences. No frozen public signature changed anywhere in this change,
so the `failed` condition ("pressure to change one") never arose and nothing
was escalated. No diff artifacts are committed alongside this README because
there are no diffs to show — the four `cmp` results above are the finding.

Independent corroboration: `check-port-boundary.mjs` (which pins the frozen
port-contract signature directly) ran green in the same sweep
(`evidence/logs/group-9-all-checkers.log`), and this change's commits touch
none of the four paths (`git diff --stat 66add22f..HEAD -- <the four paths>`
is empty).
