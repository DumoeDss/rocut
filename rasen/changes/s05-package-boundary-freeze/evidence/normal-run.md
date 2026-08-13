# `node script/check-package-boundary.mjs` — task 4.1

Fixes MAJOR-3 (review round 1): task 4.1 said "record the output" but no output was committed.
Recorded now, post-fix (BLOCKER-1, BLOCKER-2, MAJOR-1, MAJOR-2 all applied). Run 2026-08-13 on
`feat/s05-community-beta`, from repo root.

Command: `node script/check-package-boundary.mjs`

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

Matches task 4.1's expectation with one deliberate, documented change from the original
(pre-review) shape: `public-entry-only` now reports `949 file(s) scanned` and `PASS` rather than
`0 files scanned`. That is BLOCKER-1's fix — the rule's scope widened from `packages/**/src` only
(which starts empty, so it was vacuously dormant) to also cover `apps/web/src/**` and
`apps/vite-example/**`, which already hold source. It is genuinely live: nothing in the current
tree imports a bare `@opencut/*` specifier yet, so it passes, but the scan set is no longer empty
and no longer blind to a consumer-side deep import (see `inverted-import-proof.md` and the
negative-control fixture added for exactly this case). `no-internal-reexport` is the only rule
still reporting `0 files scanned` — correctly: it is asserted only over `packages/**/src`, which
holds no source until P1 moves files there (design D6), and BLOCKER-1 did not touch its scope.
