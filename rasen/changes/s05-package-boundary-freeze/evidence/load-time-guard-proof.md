# Live load-time guard proof (before/after/revert) — D-5

Fixes D-5 (review round 2): BLOCKER-2's `loadManifests` fail-closed guard — a package manifest
discovered on disk whose `name` is absent from `boundary.json.layers` causes `exit 2` before any
rule runs — was proven only by the reviewer's own sandbox inspection, recorded in `review-report.md`
as a report claim rather than a durable evidence artifact in this repo. The reviewer's own words:
"there is no honest way to make it a scan() fixture... What I do not accept is the epistemic status
it shipped with... one line in an evidence file... would make it survive independently of me."
Recorded now, against the real working tree, mirroring `inverted-import-proof.md`'s method exactly:
a genuine filesystem injection, not a fixture, reverted immediately after capturing the FAIL run. Run
2026-08-13 on `feat/s05-community-beta`, from repo root.

## Why this can't be a `scan()` fixture

`loadManifests` runs at `runCheck()` startup, before `scan()` is ever called — it reads `packages/`
off the real filesystem via `discoverPackageDirs()` (`readdirSync`, not `git ls-files`, not the
in-memory fixture file lists `fixtureScan` accepts). `runNegativeControl()`/`runConverseControl()`
never call it at all. No fixture list can exercise it; the fixture plumbing is downstream of this
guard, not upstream of it, and only reachable from the branch that never calls it. The only honest
way to prove it fires is to make the real condition true on disk, run the real command, and observe
the real exit code — exactly as this file does.

## Before (baseline)

```
$ git status --porcelain -- packages/
(no output)
```

`packages/` holds exactly the three declared package directories (`editor-ports`,
`editor-contracts`, `editor-classic`), each with a `name` present in `boundary.json.layers`.

## Injected manifest

A real, untracked directory and file were created on disk (not a fixture, not a mock):

```
$ mkdir -p packages/editor-undeclared-probe
$ cat > packages/editor-undeclared-probe/package.json
{
  "name": "@opencut/editor-undeclared-probe",
  "version": "0.0.0",
  "exports": { ".": "./src/index.ts" }
}
```

```
$ git status --porcelain -- packages/
?? packages/editor-undeclared-probe/
```

`@opencut/editor-undeclared-probe` is not in `boundary.json.layers`
(`["@opencut/editor-ports", "@opencut/editor-contracts", "@opencut/editor-classic"]`).

## After — live run with the undeclared manifest present

Command: `node script/check-package-boundary.mjs`

```
check-package-boundary: packages/ contains a manifest not declared in boundary.json's layer order, refusing to scan:
  packages/editor-undeclared-probe/package.json declares "@opencut/editor-undeclared-probe", which boundary.json.layers does not include
```

Exit code: `2`

No rule output printed at all — the guard exits before `scan()` runs, confirming this is a load-time
gate, not a rule result. `--negative-control` and `--converse-control` are pure in-memory fixture runs
(`fixtureScan` over `NEGATIVE_FIXTURES`/`CONVERSE_FIXTURES`) that deliberately never call
`loadManifests` or read `packages/` at all, so this proof is scoped to the plain invocation only —
it says nothing about, and does not need to say anything about, either control mode.

## Revert and re-run

```
$ rm -rf packages/editor-undeclared-probe
$ git status --porcelain -- packages/
(no output)
```

```
$ node script/check-package-boundary.mjs
check-package-boundary: scanned 1031 repo file(s) (tracked + uncommitted)
  PASS  acyclic-direction: every cross-package edge points to a strictly lower declared layer (949 file(s) scanned, 341 cross-package edge(s) examined)
  PASS  public-entry-only: a specifier crossing into a package resolves only to a declared exports subpath (949 file(s) scanned, 0 @opencut/* specifier(s) examined)
  ....  no-internal-reexport: 0 files scanned — packages/ holds no source yet (no package's declared entry re-exports a module owned by another package's undeclared internals)
  PASS  no-elftia-import: no package, Host or example imports an Elftia package, protocol identifier or runtime object (1031 file(s) scanned)
  PASS  react-free-base: editor-ports and editor-contracts import no React, no DOM global, and no editor-classic module (68 file(s) scanned)

clean — run with --negative-control / --converse-control to see each rule proven able to fire, and proven not to misfire.
```

Exit code: `0`

## Reading

The guard is not self-referential: a real, untracked `package.json` placed on disk with a `name`
absent from `boundary.json.layers` is refused by name and path
(`packages/editor-undeclared-probe/package.json declares "@opencut/editor-undeclared-probe"`),
`exit 2`, before any of the five rules runs. This is proven for the plain invocation only —
`loadManifests` is called exclusively from `runCheck()`; `runNegativeControl()` and
`runConverseControl()` never call it and never touch `packages/`, so they are out of scope for this
guard and correctly exit `0` regardless of what is injected on disk. Removing the injected directory
restores the exact pre-injection clean run (`341` edges, `949` files, `0` specifiers examined —
unchanged from `inverted-import-proof.md`'s baseline), confirming the guard adds no side effect
beyond the refusal itself. `git status --porcelain -- packages/` was empty both before injection and
after cleanup, so no trace of the probe remains in the working tree.
