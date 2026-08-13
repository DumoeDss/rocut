# Live inverted-import proof (before/after) — task 4.3

Fixes MAJOR-3 (review round 1): task 4.3 said "record both runs" but neither was committed. The
independent reviewer reproduced this task's spirit independently in a sandbox (`review-report.md`
probe P-A) and confirmed it TRUE, but that was the reviewer's own sandbox run, not this change's
own recorded evidence. Recorded now, against the real working tree, post-fix. Run 2026-08-13 on
`feat/s05-community-beta`, from repo root.

Method: a real inverted import was appended to a real layer-1 file
(`apps/web/src/editor/contracts/index.ts`, owned by `@opencut/editor-contracts`), reaching a real
layer-2 module (`apps/web/src/editor/surface/editor-root.tsx`, owned by `@opencut/editor-classic`
under `boundary.json`'s catch-all). This is not a fixture — it is a genuine, temporary edit to a
tracked file, reverted with `git checkout --` immediately after capturing the FAIL run.

## Before (baseline — see `normal-run.md` for the full untouched output)

`acyclic-direction` and `react-free-base` both `PASS`, exit `0`.

## Injected edge

Appended to `apps/web/src/editor/contracts/index.ts`:

```ts
import { EditorRoot } from "../surface/editor-root";
export const __t43ProbeUpwardEdge = EditorRoot;
```

## After — live run with the edge present

Command: `node script/check-package-boundary.mjs`

```
check-package-boundary: scanned 1031 repo file(s) (tracked + uncommitted)
  FAIL  acyclic-direction: every cross-package edge points to a strictly lower declared layer (949 file(s) scanned, 342 cross-package edge(s) examined)
  PASS  public-entry-only: a specifier crossing into a package resolves only to a declared exports subpath (949 file(s) scanned)
  ....  no-internal-reexport: 0 files scanned — packages/ holds no source yet (no package's declared entry re-exports a module owned by another package's undeclared internals)
  PASS  no-elftia-import: no package, Host or example imports an Elftia package, protocol identifier or runtime object (1031 file(s) scanned)
  FAIL  react-free-base: editor-ports and editor-contracts import no React, no DOM global, and no editor-classic module (68 file(s) scanned)

Package-boundary violations:
  [acyclic-direction] apps/web/src/editor/contracts/index.ts:84: @opencut/editor-contracts (layer 1) imports @opencut/editor-classic (layer 2) via "../surface/editor-root"
      why: ports sits below contracts sits below classic (design D2, measured 8/0 contracts→ports edges); an upward edge would make the freeze a fiction the moment P1 built against it.
  [react-free-base] apps/web/src/editor/contracts/index.ts:84: imports a module owned by @opencut/editor-classic via "../surface/editor-root"
      why: spec §3.5 — a third-party adapter author must implement ports and run conformance without pulling React or the editor UI.
```

Exit code: `1`

## Revert and re-run

`git checkout -- apps/web/src/editor/contracts/index.ts`, confirmed byte-identical to HEAD
(`git status --porcelain` and `git diff --stat` both empty for the file). Then:

```
check-package-boundary: scanned 1031 repo file(s) (tracked + uncommitted)
  PASS  acyclic-direction: every cross-package edge points to a strictly lower declared layer (949 file(s) scanned, 341 cross-package edge(s) examined)
  PASS  public-entry-only: a specifier crossing into a package resolves only to a declared exports subpath (949 file(s) scanned)
  ....  no-internal-reexport: 0 files scanned — packages/ holds no source yet (no package's declared entry re-exports a module owned by another package's undeclared internals)
  PASS  no-elftia-import: no package, Host or example imports an Elftia package, protocol identifier or runtime object (1031 file(s) scanned)
  PASS  react-free-base: editor-ports and editor-contracts import no React, no DOM global, and no editor-classic module (68 file(s) scanned)

clean — run with --negative-control / --converse-control to see each rule proven able to fire, and proven not to misfire.
```

Exit code: `0`

## Reading

The negative control is not self-referential: a real edge injected into a real tracked file, not a
fixture, is caught by name and line (`apps/web/src/editor/contracts/index.ts:84`), by two rules at
once — `acyclic-direction` (the edge points to a higher layer) and `react-free-base` (the target is
owned by `@opencut/editor-classic`, the one layer-0/1 code may never reach). The edge count moves
from 341 to 342, confirming the checker is actually walking the new import rather than caching a
stale result. Reverting restores a clean run with the original 341-edge count.

One process note for future runs on this machine: restoring the probe file via a plain `cp` through
`/tmp` (rather than `git checkout --`) silently reintroduced CRLF line endings on the whole file —
MSYS's `/tmp` mount applies text-mode translation on a bare copy, which a raw byte-for-byte `cp`
does not survive. `git ls-files --eol` caught it (`i/lf w/crlf` where every sibling file reads
`i/lf w/lf`) before it was committed. `git checkout -- <path>` is the safe revert for this kind of
temporary in-place probe; a manual backup/restore through `/tmp` is not.
