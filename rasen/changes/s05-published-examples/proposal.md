## Why

Spec §3.7's standard is blunt: *"an example that has never run is documentation, not evidence; an
example that runs only inside the monorepo tests our aliasing, not our packaging."* Today there
are **zero worked examples** — no `examples/` directory exists — and rocut CI (measured: one job,
`matrix.os: [ubuntu, windows, macos]`, running the three wasm checks plus the Next build) executes
nothing against installed tarballs. P3 proved the from-tarballs consumer view once, as one child's
evidence; P5's own handoff names the durable lesson: that read must survive as a **standing gate**,
not archive-bound proof. P6 is where the portfolio's outward-facing claim — an external developer
can consume the packages — becomes four runnable, CI-executed demonstrations instead of prose.

## What Changes

- **Four worked examples under a new top-level `examples/` directory** (deliberately outside the
  `apps/*`/`packages/*` workspace globs — examples must never be workspace members), committed as
  self-contained project templates that the harness materializes into the scratch project and runs
  against **installed tarballs**:
  1. **`install-packages`** — the installation walkthrough: resolve and import from declared
     entries (React-free ports/contracts at runtime), read versions and labels from the installed
     artifacts, verify the package metadata an adopter first meets.
  2. **`embed-surface`** — a Vite + React app mounting the editor Surface from the tarballs:
     own stylesheet through the declared `./surface.css` entry, own minimal committed asset set
     (the canonical allowlist lives in app build tooling — the example's README names it), a
     browser smoke asserting a booted interactive timeline, GPU-free under CI via the established
     renderer/flag patterns.
  3. **`custom-storage`** — P3's adapter promoted to example shape: an adopter's own
     `ProjectStore` behind an alien internal representation, the published engine over it, and
     the port conformance suite run from the tarballs. **The wasm-init decision, made here in the
     plan: the mock-entry honest-pair** — the production migration path runs and records its skip
     distinctly, while the 31-step chain is validated through the published
     `./evidence/wasm-test-mock` entry — with the example's README stating that it therefore
     depends on an **experimental**-labeled entry and inherits that instability (P5's label
     consequence, verbatim).
  4. **`agent-transaction`** — driving the editor through the S03 transaction API from an Agent's
     shape: the published `AGENT_SCENARIO` and vector corpus executed against the published engine
     over the example's own store, with the reload-reopen durability assertion, no browser.
- **A committed runner, `script/run-published-examples.mjs`**, importing P3's `packSdkTarballs`
  (never re-implementing packing) and a small refactor of P3's scratch-lifecycle/no-linking
  controls into an importable module — controls re-run green as the refactor's own control — so
  the examples inherit location assertions, copy-not-link checks, and the removal proof
  unchanged.
- **The consumer view becomes a standing gate**: P5's archive-bound
  `consumer-view-from-tarballs.mjs` four clauses (0.x versions, README policy anchor,
  `surface.json` set-equality, markers in extracted source, plus the fail-closed dangling branch)
  are promoted into committed tooling the runner executes every time.
- **The CI leg P6 owns**: a new `sdk-examples` job in `.github/workflows/bun-ci.yml` —
  ubuntu-latest, the runner invoked purely through its env seams (scratch root via
  `OPENCUT_SCRATCH_ROOT` into a non-Temp, non-repo path; bun via `OPENCUT_BUN`), executing all
  four examples and the consumer view against freshly packed tarballs. Deliberately **not**
  claimed: the ~28 local-only static checkers stay local; the OS matrix is not extended (the
  runner is OS-neutral via its seams; extending is a config change, not a port); nothing
  publishes anywhere.
- **Labels surface where adopters read them**: each example's README names every `@opencut/*`
  entry it consumes with its P5 class, and the custom-storage example carries the
  experimental-inheritance statement. No example reads `surface.json` at runtime — labels change
  no import behavior (P5's rule).
- **Census discipline for the new directory**: `examples` is declared as a consumer in
  `packages/boundary.json` (P2's derived scan roots pick it up), the boundary census grows by the
  examples' code files, `no-elftia-import` covers them repo-wide automatically, and every checker
  that could see the new paths gets a recorded scope decision.

## Capabilities

### New Capabilities

- `sdk-published-examples`: the four worked examples and their shapes; execution from installed
  tarballs under the inherited no-linking controls; the standing consumer-view gate; the CI leg
  and what it does not claim; label visibility in example documentation; and the stated
  non-coverage.

### Modified Capabilities

*(none — P3's "no CI leg is claimed" scenario describes P3's own change truthfully and stays;
P5's labeling spec needs no change because labels are already declarative metadata the examples
only cite.)*

## Impact

**Added**

- `examples/{install-packages,embed-surface,custom-storage,agent-transaction}/` — four project
  templates (own `package.json`/tsconfig/README; TypeScript self-check as each example's own
  execution step), plus `script/run-published-examples.mjs` and the promoted consumer-view
  module. One job in `.github/workflows/bun-ci.yml`.

**Modified**

- `packages/boundary.json` (+1 consumer), `script/run-scratch-conformance.mjs` (the small
  lifecycle/controls extraction, P3's own runner re-run green afterward), `BOUNDARIES.md`
  (examples section, consumer entry, checker-audit rows, CI leg statement).

**Untouched, deliberately**

- The four frozen S03+S04 surfaces (byte-identical control stands), the packages' export maps and
  `surface.json` (no entry should be forced; if one is, it lands classified-at-birth with the
  forcing example named — P5's rule), the 28-checker family's rules, `apps/*` (no example touches
  Electron — the electron Host already covers desktop; examples stay node/browser-shaped).

**Not covered by this change, stated so silence is not read as coverage**

- Legal/notices content inside the examples' files (READMEs, manifests) — **P7's** sweep will
  touch them; P6 notes the surfaces and does not pre-empt.
- The wasm-init runtime fix — Direction-level, LEAD-owned; the example demonstrates the honest
  pair, not a repair.
- Windows/macOS CI legs for the examples job, registry publishing, the local-only checkers'
  promotion to CI — each named, none attempted.
