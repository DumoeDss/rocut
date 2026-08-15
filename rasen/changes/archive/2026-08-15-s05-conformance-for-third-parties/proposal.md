## Why

B1's narrow reading removed the registry from S05, and with it the only thing that would have
tested the *distribution* path. Nothing today proves the packages survive `npm pack`, install, and
consumption from outside the monorepo: the three consumers all resolve through workspace symlinks,
and the one thing §3.5 exists to prove — that a stranger can implement the ports and run the
conformance suites from installed artifacts — has never once been executed. The suites themselves
are already outside-ready by construction (plain async functions taking data, never paths), but
two measured gaps stand between them and an outside adapter author: **the corpus and the contract
surface have no declared entry** (an installed consumer can reach the runner but not the data it
runs), and **a failing case names itself, not the frozen requirement it exercises**.

## What Changes

- **A pack-and-install harness, committed and reusable by P6**: `npm pack` each package, install
  the tarballs into a scratch project **outside the monorepo with no workspace linking**, and run
  from there. On this machine the scratch root sits on an E:-drive path outside any Temp directory
  (measured AV hazard); the root is env-configurable so the same harness is CI-ready. npm's own
  shasum/integrity output plus a per-file inventory is recorded as the committed
  **digest-manifested** evidence.
- **The no-linking control is load-bearing and three-sided**: the scratch root is asserted outside
  the repo tree; the installed `@opencut/*` packages are asserted to be real copies, not links;
  and a control run with the installed copy of a package removed **fails** — proving the run
  depends on the tarballs, not on reaching back into the workspace.
- **A gate-first resolution spike**: `editor-contracts` depends on `@opencut/editor-ports:
  workspace:*`, and a packed tarball carries that protocol verbatim — resolution outside a
  workspace is a measured unknown. The gate proves tarball-order install plus `overrides`
  (npm or bun) before the harness is built on top; the chosen mechanism is recorded with its
  evidence, and mutating the packed manifest is explicitly rejected.
- **Attributed consumable entries (the monotone-growth rule's next exercise)**: one new
  `editor-contracts` entry `./vectors/corpus` — exporting the corpus as **exact file bytes**
  (an fs-based reader over the shipped `src/vectors/corpus/` files; static JSON imports are
  rejected because re-stringified bytes break the manifest digest) plus a data-form
  `PUBLISHED_CONTRACT_SURFACE` — and per-package `./conformance/requirements` entries on both
  packages carrying a **requirement index** (case name → frozen requirement id) and a small
  formatter that renders failures as "requirement / case / detail". In-repo drift guards assert
  the published surface equals `parseContractSurface` over the real sources and that every case
  name any suite can report has an index entry.
- **Prove by doing — a worked adapter that is none of the three Hosts**, committed as a template
  under `script/fixtures/third-party-adapter/` and materialized into the scratch project by the
  harness: its own differently-shaped store (opaque payload preserved through a deliberately
  alien internal representation), its own ids/assets/diagnostics, the **published** engine over
  its own store for the engine/draft/vectors suites, and migration implemented by replicating the
  per-record walk over the published `migrations` + `CURRENT_PROJECT_VERSION` (the runner itself
  is IndexedDB-hardwired — P2's finding). A **deliberately non-conforming variant** (a store that
  normalizes payloads away) must fail the named cases — the ports-level mutation matrix mirroring
  S03+S04's vector matrix — while the differently-shaped conforming adapter passes every suite.
- **The scratch run is the evidence**: all five suites execute from the installed tarballs, their
  reports captured with self-logged exit codes, failures rendered through the requirement
  formatter, and the whole transcript committed.
- **A checker-audit row for every new file** (P2's standing rule): the adapter template's
  `@opencut/*` imports join the boundary checker's scan set, the census grows, and every checker
  that could see the new paths gets a recorded scope decision.

## Capabilities

### New Capabilities

- `sdk-third-party-conformance`: the pack-and-install harness and its no-linking controls; the
  consumable corpus and contract-surface entries with drift guards; the requirement-index
  legibility layer; the worked adapter with its non-conforming variant; and the executed
  from-installed-tarballs evidence.

### Modified Capabilities

- `transaction-automation-api`: one requirement changes — *A versioned wire-safe transaction
  vector corpus is published*. Its text still names the pre-P1 location
  (`apps/web/src/editor/contracts/vectors/`, which no longer exists), and P3 makes the corpus
  consumable from a declared package entry rather than only from a checkout: the requirement is
  restated at the package location with an added installed-consumption scenario. (Other stale
  `apps/web/src/editor/...` references elsewhere in that spec are recorded as a finding for the
  LEAD, not silently swept into this change.)

## Impact

**Added**

- `script/pack-sdk-tarballs.mjs` (pack + digest inventory; the module P6 reuses) and
  `script/run-scratch-conformance.mjs` (scratch project lifecycle, install, run, controls).
- `packages/editor-contracts/src/vectors/corpus/index.ts` + `packages/editor-contracts/src/conformance/requirements.ts`
  + `packages/editor-ports/src/conformance/requirements.ts` (or equivalent module shapes) and
  their export-map entries, each attributed to the consumer that forced it.
- `script/fixtures/third-party-adapter/` — the worked adapter and its non-conforming variant,
  plus in-repo drift-guard tests.

**Modified**

- The two packages' `exports` maps (three attributed additions, all additive; no entry removed,
  renamed, or repointed). `BOUNDARIES.md` (harness section, entry attributions, checker-audit
  update).

**Untouched, deliberately**

- The five suites' code and every frozen S03+S04 public signature — the requirement index is
  published **beside** the suites and joined by name, precisely so no suite or frozen surface is
  edited; pressure to do otherwise is a `failed` finding returned to the contract.
- The parity harness and the three Hosts (P3's adapter is not a Host and adds no host profile).
- The 255-error lint debt, versioning/labeling (P5), examples (P6), provenance regeneration (P7).

**Not covered by this change, stated so silence is not read as coverage**

- **No CI leg.** Spec §3.5 demands executed evidence, not CI; §3.7's CI execution is P6's, and P6
  reuses this harness to add it. The harness is CI-ready (env-configurable roots, no machine
  assumptions) but nothing here runs on push.
- Registry-specific behaviour (publish transforms, provenance/signature checks, scoped auth,
  cold-cache install) — excluded by B1's ruling and claimed nowhere.
- A browser/draft-manager adapter: the worked adapter exercises the ports, transaction, engine,
  draft and vectors suites under Node; it does not implement a React draft UI manager beyond what
  the draft conformance fixture requires.
