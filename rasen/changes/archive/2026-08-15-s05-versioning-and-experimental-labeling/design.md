## Context

Measured at this propose (method: the three `packages/*/package.json` export maps read directly;
`./package.json` entries excluded as mechanical):

| package | entries | version | notable |
| --- | ---: | --- | --- |
| `@opencut/editor-ports` | 6 | `0.1.0` | the frozen ports barrel + in-memory + conformance entries |
| `@opencut/editor-contracts` | 11 | `0.1.0` | frozen domain/engine/vectors surface + P3's corpus/requirements entries |
| `@opencut/editor-classic` | 19 | `0.1.0` | mixes frozen Surface embedding with provider/experimental surface |
| **total** | **36** | | zero classifications today |

`files` in every manifest lists `README.md`, `LICENSE`, `NOTICE` — **none of those files exist**,
so a tarball ships no policy statement at all. `packages/README.md` (repo-level, not shipped)
still says "`packages/*/src` is empty" — false since P1. The four S03+S04 frozen surfaces are
byte-identical to their base per P3's close (the `git show <base>:<path> | cmp` control), and that
control is the constraint any labeling mechanism must survive.

Reused, not re-derived: P3's `packSdkTarballs` module + `SDK_PACKAGES` (never re-implement
packing), the `OPENCUT_PREPACKED_DIR` seam, the checker-family idiom (negative + converse
controls, census lines, empty-scan refusal, `git ls-files --cached --others --exclude-standard`
scan sets), and the P3 handoff's rules — manifest truth, evidence-log freshness, report
arithmetic derived from log lines, and the F2 delivery-audit pairing (scenario clause ↔ evidence
line, before archive).

## Goals / Non-Goals

**Goals:**

- A stated `0.x` compatibility policy, visible from an installed tarball, with three surface
  classes whose promises are written down.
- Every one of the 36 export entries classified with a reason, machine-checkable, fail-closed on
  gaps — and every future entry classified at birth.
- A checker that makes an unlabeled experimental export fail, joining the family with controls
  and census.
- The four frozen surfaces remain byte-identical — labeling is manifest-carried for `frozen`
  classes precisely so no frozen file is edited.
- Versions, policy, manifest and markers proven from the packed tarballs (the consumer's view).

**Non-Goals:**

- Editing any frozen signature or frozen file (pressure = a `failed` finding to the contract);
  fixing the wasm-init Direction finding (LEAD-owned, recorded as policy truth only); legal
  artifacts (P7); release automation; CI legs (P6's decision); renumbering or repointing any
  entry (the monotone rule stands unchanged).

## Decisions

### E1 — Taxonomy: exactly three classes, each with a 0.x promise

| class | meaning | promise within `0.x` |
| --- | --- | --- |
| `frozen` | contract surface frozen by S02/S03+S04 (ports barrel, contracts domain/engine/vectors, the Surface embedding) | additive-only; a signature change is not permitted at any `0.x` version — it is a finding returned to the contract |
| `provider` | OpenCut Classic convenience (UI atoms, media helpers, storage barrel, session composition) | may change in any minor; will not be silently removed within a minor |
| `experimental` | explicitly unstable (evidence/test-infrastructure entries, narrow fixtures) | may change **or be removed** in any minor, without a deprecation window |

Exactly three because spec §3.6's dichotomy is "frozen contract vs Classic-provider convenience",
with `experimental` as the spec's own third word; a fourth class would be taxonomy for its own
sake. Every classification carries a one-line reason; entries whose class is genuinely mixed
resolve at the symbol level (E2), not by inventing a mixed class.

### E2 — Mechanism: a shipped manifest carries every classification; in-source markers only for non-frozen classes

`packages/<pkg>/surface.json` — committed, added to `files`, shipped — maps every export entry to
`{ class, reason }`, with optional per-symbol overrides `{ symbol, class, reason }` where one
entry mixes classes (classic's root `.` is the known case: `core`/`utils` provider surface beside
frozen-carrying re-exports). `./package.json` entries are exempt (mechanical).

**Source markers — `@opencutSurface <class> — <reason>` as the entry file's first doc-comment
line — are REQUIRED for `provider` and `experimental` entries, and FORBIDDEN to be the reason a
`frozen` file is edited.** The split is what reconciles labeling with the frozen-surface
control:

- A consumer's "telling a frozen contract from a convenience" is answered by the **manifest**,
  which ships in the tarball and is the classification's source of truth; the in-source marker is
  the belt to that braces for the two classes where a reader of the source most needs the warning
  in place.
- The four frozen files stay byte-identical (classification is manifest-only for `frozen`), so
  the P2/P3 byte-control keeps passing without redefinition.
- If a `frozen`-class entry's file ever appears to need a marker, that is misclassification or
  frozen-surface pressure — escalate, don't edit.

*Rejected: JSDoc-only labeling* — not machine-checkable without parsing the whole type surface,
and it forces edits into frozen files. *Rejected: naming conventions (`unstable*` prefixes)* —
renames symbols, which is frozen-signature pressure by another name. *Rejected: classification
in `package.json` itself* — mixes policy data with the manifest's mechanical role and invites
merge noise; a sibling file with one job.

### E3 — The checker: `check-sdk-surface-labels.mjs`, fail-closed in the house idiom

Rules, all refusing empty scans:

1. **Completeness** — every export entry of every package appears in that package's `surface.json`
   with a known class and a non-empty reason; every `surface.json` row names a real export entry.
   An entry added to an export map without a classification fails — classification at birth.
2. **Marker agreement** — every `provider`/`experimental` entry's target file carries its
   `@opencutSurface` marker; a `frozen` row whose target file carries a *different* class's
   marker is a mismatch failure.
3. **Override validity** — every symbol override names a symbol the entry actually exports
   (resolved through the same source-scan extraction the boundary checker uses).
4. **Census** — per-package entry counts and per-class counts printed every run; the numbers are
   regression tests (P1's lesson: a collapsed census is a failure at `PASS`).

Controls: `--negative-control` materializes an unlabeled experimental export (a synthetic entry +
row without a source marker, and an export entry with no row at all) and each must fire;
`--converse-control` proves silence on properly labeled rows, on `frozen` rows without markers
(the designed state), and on prose that merely mentions a class name. The checker joins
`package.json`'s script list and the every-checker-green sweep; per P3's finding,
`boundary.json` needs no edit (entries derive from export maps at load time), but
`BOUNDARIES.md`'s table gains the labeling rows.

### E4 — Version policy: stated, shipped, and applied once

Each package's new `README.md` carries the same policy statement (the per-package README is the
only policy text a tarball consumer is guaranteed to see; it makes the existing `files` entry
real):

- Versions are `0.MINOR.PATCH`. Within `0.x`, **minors may change anything the classes permit and
  nothing they don't**: `frozen` is additive-only; `provider` may change in a minor;
  `experimental` may change or be removed in a minor. Patches fix defects without surface change.
- No stability claim beyond this policy; **no `1.0` claim exists in any published material**.
- The Classic migration surface (`./storage/migrations`) states its known constraint: the
  published migration chain currently requires the wasm test-mock entry to initialize in plain TS
  consumers (the Direction-level wasm-init finding, recorded here as policy truth; a fix is
  tracked at Direction level, not in this package).

**The policy's first application:** bump all three packages to `0.2.0` in this change, the
minor recording the export-entry additions P0→P5 (six entries across ports/contracts/classic
since the first freeze). Holding `0.1.0` is the named alternative and remains conforming — the
bump exists so the policy is a rule that has fired, not prose; if review prefers holding, the
policy's effective-from point simply moves. Nothing resolves against the literal version
(`workspace:*` in-repo; P3's harness maps tarball names structurally, so the filename change
flows through without harness edits — verified at the tarball-view task).

### E5 — The no-`1.0` sweep is semantic, not substring

`"0.1.0"` contains `"1.0"`; `"stable logical id"` is not a stability claim. The sweep therefore
reads hits, not counts them: enumerate candidate strings (`1.0`, `stable`, `production-ready`,
`semver`, `GA`) across everything a tarball ships (`src/**` doc comments, `README.md`,
`surface.json`, manifests) plus the repo-level published material (`packages/README.md`,
`BOUNDARIES.md`, the DECISIONS docs under `src/`), and give each hit a disposition. The same task
restates `packages/README.md` at the current tree — its "src is empty / every module still lives
under apps/web/src" text has been false since P1 — with the restatement's figures carrying method
and measurement point inline (P2's reviewer expectation).

### E6 — The consumer view is proven from the tarballs, not the workspace

Reuse `packSdkTarballs` (import, never re-implement; `OPENCUT_PREPACKED_DIR` supported) and
verify from the packed inventory plus an extract: every tarball's `version` is `0.x`; `README.md`
ships and contains the policy statement; `surface.json` ships and classifies exactly the
export-map entries (count reconciliation against E3's census); a non-frozen entry's marker is
present in the extracted source. **Manifest truth:** markers, manifests and READMEs add no
runtime-closure imports — assert the packages' dependency blocks are unchanged except the
version field; if implementation does add any import, declare it in the same commit and run the
scratch harness before claiming done (P3's rule).

### E7 — What P6 should expect to consume

The stable reading path for P6's four examples, stated here so P6 plans against it:

- `surface.json` per package (shipped, versioned with the package) — the classification source.
- The `@opencutSurface` markers in non-frozen entry source — the in-code annotation.
- The policy README — the prose statement, including the wasm-init constraint P6's
  custom-storage example must plan around (P3's handoff: choose the mock-entry shape or scope
  migration out, in the plan, not mid-apply).

Labels do not change import behavior; examples import exactly as before and annotate from
`surface.json`.

### E8 — Sequence

1. **Baseline:** capture the 36-entry inventory with method inline, the current checker census,
   and the byte-control over the four frozen surfaces (the before-half).
2. **Policy + READMEs:** policy text, per-package READMEs, version bump decision applied.
3. **Manifests + markers:** author the three `surface.json` files with per-entry reasons (the
   classification table is the reviewable core: frozen four, provider set, experimental set);
   add markers to non-frozen entry files; verify frozen files byte-untouched.
4. **Checker:** implement, wire controls and census, join the family, all-green sweep.
5. **Tarball view:** pack, verify consumer-view items, manifest-truth assertion.
6. **Sweep + docs:** semantic no-`1.0` sweep with per-hit dispositions; `packages/README.md`
   restatement; `BOUNDARIES.md` labeling section; checker-audit row.
7. **Delivery audit:** pair every scenario clause with its evidence line (the F2 class); frozen
   byte-control re-run; strict validate; ship local.

## Risks / Trade-offs

- **[A `frozen` file appears to need an in-source marker.]** → By design it never gets one; the
  classification moves to the manifest, and genuine pressure is escalation to the contract.
- **[The manifest drifts from an export map.]** → Rule 1 fails closed in both directions; the
  census numbers are regression tests; classification-at-birth is the same discipline as entry
  attribution.
- **[Symbol overrides rot as barrels grow.]** → Rule 3 resolves overrides against real exports
  each run; a dangling override fails.
- **[The version bump breaks P3's harness.]** → Tarball names are mapped structurally (P3's name
  map keys package names); the tarball-view task runs the pack path and would catch it; if it
  somehow bites, holding `0.1.0` is the named conforming fallback.
- **[The no-`1.0` sweep degenerates into substring counting.]** → E5's per-hit disposition is the
  deliverable; a count without dispositions is not evidence.
- **[Markers become stale comments if a class changes.]** → Rule 2 binds manifest and marker; a
  reclassification without updating the marker fails.

## Migration Plan

Additive policy layer: manifests, markers in non-frozen files, READMEs, one checker, version
bumps. Rollback is `git revert`. No consumer behavior changes — labels are data and comments.
Ship mode **local (commit only)**; the portfolio delivers once, at the parent.

## Open Questions

- **The version bump** — `0.2.0` proposed as the policy's first application (E4); holding
  `0.1.0` is the conforming alternative if review prefers a stable point until P6/P7.
- **Symbol-level granularity of classic's root `.` entry** — the override list starts minimal
  (only genuinely mixed symbols); whether more entries need overrides is settled by the
  classification table at task time, not pre-decided here.
- **Where `surface.json` lives if P7 later wants a combined manifest** — a per-package file is
  chosen now because each package ships independently; consolidation is P7's call with the
  tarball shape in hand.

### Task-time rulings (recorded here, per the delivery-audit rule: rulings live in the
### design, never in the spec text)

- **The version bump — ruled `0.2.0`** (applied at Group 2). The artifacts' own E4 decision
  governed; no review round overruled it, and P3's harness proved version-agnostic
  (`nameOfTarball` strips the version before its name-map lookup), so no harness edit was
  needed or made.
- **Symbol-level granularity of classic's root `.` — ruled: no overrides at all.** The full
  re-export closure was traced at task time and carries zero frozen-classified symbols (the
  frozen transaction barrel and Surface embedding types are not re-exported from the root),
  so the production manifests carry no `symbols` arrays; the override mechanism exists and is
  enforced by the checker's controls (dangling fires, resolving stays silent).
- **Where `surface.json` lives — unchanged (per-package)**; no new information arose at task
  time that reopens it.
- **Scope ruling surfaced by delivery: the dangling `./vectors/drivers` entry — adjudicated by
  the LEAD on 2026-08-15, ruled REMOVE, executed in the group-8 completion pass.** The
  consumer-view proof found the entry (declared by P0's `5e3fc7cb`) points at a file no
  commit ever authored. First ruled OUT of this change's scope: authoring the missing index or
  removing the frozen-classified entry is contract adjudication — labeling labels the declared
  surface, it does not repair it — and escalated. The LEAD's ruling came back the same day:
  the entry never worked (target authored in no commit), has zero importers (removal breaks
  nobody — a consumer gets module-not-found either way), the four frozen S03+S04 surfaces are
  code signatures untouched by a manifest correction (the exports map is S05-authored surface),
  and inventing an index now would create surface with no forcing consumer. Executed: the entry
  left `editor-contracts`' export map and its `surface.json` row in the same edit (census
  36 → 35, frozen 17 → 16, dangling 0), the checker gained the fail-closed fourth rule
  `target-existence` (any class), and the consumer-view verifier fails the same condition from
  the packed tarball. Re-add only with a named forcing module.
