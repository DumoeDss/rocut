# `--negative-control` / `--converse-control` — task 4.2

Fixes MAJOR-3 (review round 1): task 4.2 said "record both outputs" but neither was committed.
Recorded now, post-fix. Run 2026-08-13 on `feat/s05-community-beta`, from repo root. Both controls
run the same pure `scan()` against in-memory fixtures — no repo I/O, no dependence on the current
working tree.

The fixture lists grew in review round 1: three new **negative** fixtures prove each of
BLOCKER-1/MAJOR-1/MAJOR-2's fixes can actually fire (a regression in any of the three would show
as a silent `FAIL` line below), and three new **converse** fixtures prove none of those same fixes
introduced a new false positive, plus the bundled minor (MINOR-3) gives `no-internal-reexport` its
first converse fixture — five of five rules now have one, not four of five.

## `--negative-control`

Command: `node script/check-package-boundary.mjs --negative-control`

```
check-package-boundary: negative control
  PASS  acyclic-direction — caught [layer-1 (contracts) importing a layer-2 (classic) module is an upward edge]
  PASS  no-elftia-import — caught [a bare @elftia/* import specifier]
  PASS  react-free-base — caught [editor-ports importing react]
  PASS  public-entry-only — caught [a package source file deep-importing an undeclared subpath of another package]
  PASS  no-internal-reexport — caught [a declared entry re-exporting an undeclared subpath of another package]
  PASS  public-entry-only — caught [BLOCKER-1 regression: a consumer-side file outside packages/ deep-importing an undeclared subpath — invisible to the pre-fix packages/**/src-only scan set (the reviewer's own P-E reproduction used exactly this shape)]
  PASS  react-free-base — caught [MAJOR-1 regression: a document-named parameter used only as a domain value no longer blinds detection of a real document.createElement(...) call elsewhere in the same file]
  PASS  react-free-base — caught [MAJOR-2 regression: globalThis.document reaching a DOM member is caught, closing the globalThis-prefixed hole the bare-globalThis exemption previously left open]

negative control clean — every rule is proven able to fail.
```

Exit code: `0`

## `--converse-control`

Command: `node script/check-package-boundary.mjs --converse-control`

```
check-package-boundary: converse control
  PASS  acyclic-direction — silent [a legal downward edge (classic importing ports)]
  PASS  public-entry-only — silent [an import of a declared entry]
  PASS  no-elftia-import — silent [an Elftia mention in prose (a comment)]
  PASS  react-free-base — silent [a React import inside @opencut/editor-classic]
  PASS  public-entry-only — silent [a consumer-side (non-packages/) import of a declared entry — the widened BLOCKER-1 scope must not misfire on a legal import]
  PASS  no-internal-reexport — silent [a declared entry re-exporting a DECLARED subpath of another package (not an undeclared internal)]
  PASS  react-free-base — silent [a local document parameter used only as a domain value (no DOM member access) — the MAJOR-1 fix must not misclassify a domain document]
  PASS  react-free-base — silent [a typeof globalThis.document environment-detection guard (agent-drivers.test.ts's own idiom) — not DOM consumption]

converse control clean — no rule fires on a legal case.
```

Exit code: `0`

## Reading

8 negative fixtures, 8 converse fixtures, all clean. Each of the four review-round-1 code fixes
now has a dedicated pair — one fixture proving the hole is closed (negative), one proving the fix
does not misfire on the adjacent legal case it had to stay compatible with (converse):

- **BLOCKER-1** (`public-entry-only` scope): negative fixture places the violating deep import at
  `apps/web/src/editor/surface/violation5.ts` — outside `packages/`, exactly like the reviewer's
  own P-E reproduction — and it is caught; converse fixture places a legal declared-entry import at
  the same kind of path and it stays silent.
- **MAJOR-1** (document-parameter blast radius): negative fixture puts an unrelated
  `document: { title: string }` parameter in the same file as a real
  `document.createElement("div")` call, and the real call is still caught; converse fixture proves
  a domain `document` value used only via a non-DOM member (`document.tracks.length`) never fires.
- **MAJOR-2** (`globalThis.document` hole): negative fixture is
  `globalThis.document.createElement("div")`, caught; converse fixture is the literal idiom
  `agent-drivers.test.ts` uses in production — `typeof globalThis.document === "undefined"` — and it
  stays silent, so the fix did not break that file's real, unrelated assertion.
- **MINOR-3** (bundled): `no-internal-reexport` converse fixture re-exports `@opencut/editor-ports/host`,
  a subpath that fixture manifest's `exports` map declares, from a declared entry file — stays
  silent, distinguishing it from the existing negative fixture's undeclared `/internal/secret`
  subpath.
