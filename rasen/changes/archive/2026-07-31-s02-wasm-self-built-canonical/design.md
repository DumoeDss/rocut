## Context

At `main@49f8a88a` the editor imports `opencut-wasm` from three modules —
`apps/web/src/wasm/media-time.ts`, `apps/web/src/services/renderer/gpu-renderer.ts` and
`apps/web/src/services/renderer/compositor/wasm-compositor.ts` — and that specifier resolves to the
**npm registry package `opencut-wasm@0.2.10`**, declared in both the root `package.json` and
`apps/web/package.json`. The fork's own `rust/` workspace (7 crates, `rust/wasm` producing the
cdylib) is present, buildable and *unused at runtime*. `UPSTREAM.md` states the position plainly:
*"The editor consumes the published npm `opencut-wasm@0.2.10`, not a locally built artifact… Building
from `rust/` does not become the canonical path in this Slice."* This change is the Slice that
reverses that sentence.

Three facts from the repository shape every decision below.

1. **`rust/wasm/pkg/` is gitignored** (`.gitignore`, logged as patch P-002 with the rationale that
   generated output "does not belong in version control"). The repository's established convention
   is that generated artifacts are *checked mechanically*, not committed — `UPSTREAM.md` says the
   same thing about the distributable graph: *"what is in the distributable graph is not answerable
   by directory layout. It is answered mechanically."*
2. **CI already builds the wasm, in the right order, and then ignores it.**
   `.github/workflows/bun-ci.yml` runs `rustup target add wasm32-unknown-unknown`, installs
   `wasm-pack`, caches `~/.cargo` + `target`, and runs
   `wasm-pack build rust/wasm --target bundler --out-dir pkg` — all **before** `bun install`. Today
   that build is vestigial: nothing consumes its output. This is the single largest input to the
   decision below, and it was not visible in the Slice Plan.
3. **`script/generate-sbom.mjs` actively asserts the licence defect still exists.** Its `D-5` probe
   returns true only while `rust/wasm/Cargo.toml` declares `license = "MIT"` **and** no LICENSE file
   exists in either `rust/wasm/` or `node_modules/opencut-wasm/`; the generator then
   `process.exit(1)`s if any documented defect goes missing, printing *"Either the repository was
   repaired (which must be patch-logged and the SBOM text updated) or the probe is stale."* Adding
   `rust/wasm/LICENSE` therefore **breaks the SBOM generator by design**. That is the guard working,
   not an obstacle to route around.

The load-bearing constraint on scope: C0's entire observable outcome is that the self-built artifact
**corresponds** to published `opencut-wasm@0.2.10` — S01 proved byte-for-byte equality on
`opencut_wasm.d.ts`, `package.json` and `opencut_wasm.js`, with all **638 exported symbols
identical** in `opencut_wasm_bg.js` and only wasm-bindgen closure-trampoline hashes differing. Any
task that adds or changes an export destroys that evidence and belongs to C0b.

## Goals / Non-Goals

**Goals:**

- The `opencut-wasm` module the editor loads at runtime is built from this repository's `rust/`
  sources, on both Hosts, in development and in a served production build.
- That fact is **mechanically verifiable with a negative control**, not merely documented — a
  registry copy left in `node_modules` must fail the check loudly rather than silently satisfy every
  import.
- The correspondence to published `0.2.10` is **re-established on the artifact that is actually
  consumed**, not carried forward on S01's word, and any divergence is enumerated and attributed.
- `rust/wasm/LICENSE` exists; D-5's disposition in `SBOM.md` and `generate-sbom.mjs` moves from
  "recorded, not repaired" to "repaired", with a patch id and evidence.
- Both Hosts build and pass the parity fixture **unchanged**. Parity movement here is a defect, not
  a result.

**Non-Goals:**

- Any new, removed or changed WASM export — that is **C0b**, and doing it here would make this
  change's only evidence unobtainable.
- Any change to `rust/wasm/src/**` or `rust/crates/**` beyond the added LICENSE file.
- Any change to editor source under `apps/web/src/**`.
- Repairing metadata defects D-1 through D-4. They stay recorded and unrepaired; only D-5, which
  this change's own scope makes a live release gate, is repaired.
- Editing `script/fixtures/type-baseline.json`. It is a **pin snapshot** regenerated only from
  `git archive cf5e79e9`, never from HEAD.
- Committing a built binary artifact — see decision **D-A2**.

## Decisions

### D-A — The self-built artifact becomes canonical by **building from source**, via a `file:` dependency on `rust/wasm/pkg`

`"opencut-wasm": "file:./rust/wasm/pkg"` in the root `package.json`, and the path-relative
equivalent in `apps/web/package.json`. `bun install` then resolves the specifier to the locally
built package. `rust/wasm/pkg/` stays gitignored and stays the wasm-pack `--out-dir`; no new
directory is introduced and P-002's ignore rule is untouched.

*Why.* CI already builds the wasm before `bun install` (context fact 2), so the ordering this
requires is the ordering that already exists — the change makes an existing vestigial step
load-bearing rather than adding a new one. `script/setup-rust` and `script/setup-rust.ps1` already
install rustup and wasm-pack, so the toolchain onboarding path exists too. And for a change whose
entire purpose is *"the fork's `rust/` is canonical"*, source is the review surface; anything else
leaves `rust/` decorative.

**Alternative D-A2 — commit the built artifact** (un-ignore `pkg/`, or copy the five emitted files
into a tracked `packages/opencut-wasm/` workspace member). *Rejected.* It contradicts the repository's
stated convention that generated output is checked, not committed (P-002); it adds ~3.2 MB of binary
to git **per rebuild**, and C0b, C3 and C6 all rebuild; and a reviewer cannot verify a committed
`.wasm` blob, so the Rust source would stop being the thing under review at exactly the moment it
starts mattering. It also has a mechanical wrinkle: `wasm-pack` writes a `.gitignore` containing `*`
into its out-dir on every build, so a tracked out-dir needs continuous defence. **Reconsider only if
the Rust toolchain requirement proves to block a Host or a contributor**, at which point the
mitigation is a published package under the fork's own name, not a committed blob.

**Alternative D-A3 — keep the registry dependency and alias `opencut-wasm` to `rust/wasm/pkg` in
both build configs.** *Rejected.* "Canonical" becomes conditional on two build configs agreeing, the
type declarations would still resolve to the registry copy for `tsc` (silently checking against the
wrong `.d.ts` the moment C0b diverges), and it leaves two sources of one module — the precise
condition the check in **D-D** exists to detect.

**Consequence, stated plainly**: building the wasm becomes a **required** step in the developer path.
This is the requirement change `developer-reproducibility` records. It costs one cold Rust build per
machine (~15 min, per `UPSTREAM.md`'s recorded measurement), not one per worktree, provided
`CARGO_TARGET_DIR` is set to a shared path — see **D-G**.

### D-B — Module resolution changes are attempted **last**, and only if resolution actually fails

The Plan's touch set lists `apps/vite-example/vite.config.ts` and `apps/web/next.config.ts` as
"module resolution only". Both already handle the published package's wasm-pack `--target bundler`
output (`vite-plugin-wasm` + `vite-plugin-top-level-await` + `target: "esnext"`), and the self-built
package is the *same shape* — same `main`, same `types`, same `sideEffects`. So the working
hypothesis is that **no build-config change is needed at all**, and the tasks are ordered to test
that hypothesis before editing either file. Editing them speculatively would enlarge the diff and
weaken the "no behaviour change" claim.

### D-C — The correspondence is measured **twice**, and the LICENSE is added between the two measurements

`wasm-pack` copies a crate's LICENSE files into its out-dir when `license` is declared (that is the
mechanism behind the warning D-5 records). Whether it also adds them to the generated
`package.json`'s `files` array is **not established here and must not be assumed** — the published
`0.2.10` manifest lists exactly four entries and no LICENSE, so if wasm-pack does list it, the
manifest's byte-identity with `0.2.10` breaks the moment `rust/wasm/LICENSE` exists.

Therefore:

1. **Measurement A — before adding the LICENSE.** Build, compare all five emitted files against a
   scratch install of published `opencut-wasm@0.2.10`. This must reproduce S01's result: `.d.ts`,
   `package.json` and `opencut_wasm.js` byte-identical; `opencut_wasm_bg.js` differing only in
   wasm-bindgen internals with **638 exported symbols identical**; `.wasm` differing in size and
   hash, which is explicitly **not** the criterion (design D11).
2. **Measurement B — after adding the LICENSE.** Re-run the same comparison. Either it is unchanged
   (wasm-pack copies but does not list the licence) or `package.json` gains exactly one `files`
   entry. **Both outcomes are acceptable**; what is not acceptable is discovering the delta later
   and being unable to attribute it. Whichever occurs is written into `UPSTREAM.md` as an enumerated,
   attributed divergence.

This ordering is why the correspondence criterion in the `upstream-provenance` delta is restated as
"equality on the exported-symbol set and the declaration, with every other divergence enumerated and
attributed" rather than as unconditional equality. A criterion that cannot survive a deliberate,
in-scope repair is a criterion that will be quietly abandoned the first time it binds.

### D-D — `script/check-wasm-source.mjs`: prove the *resolved* artifact, not the *declared* one

The declaration in `package.json` is not evidence. bun may symlink or copy a `file:` dependency, a
stale `node_modules/opencut-wasm` from a previous registry install can survive a lockfile change,
and both Hosts resolve independently. The check therefore asserts, at the resolved path
`node_modules/opencut-wasm`:

- the emitted files' content **matches `rust/wasm/pkg`** (content hash per file, not mtime — a
  symlink passes trivially, a stale copy fails);
- `rust/wasm/pkg` is **not stale relative to its inputs** — newest mtime across
  `rust/wasm/src/**`, `rust/crates/**/src/**`, `rust/wasm/Cargo.toml` and `Cargo.lock` is older than
  the emitted `.wasm`;
- `rust/wasm/LICENSE` exists and is byte-identical to the root `LICENSE`.

**Negative control** (the repository's standing pattern — a green result must not be vacuous): the
check runs a second time against a fixture directory holding the *published* package's manifest and
must report failure. A check that cannot fail is not evidence, and this one is load-bearing for
every later child in the Slice.

The check does not attempt to run `cargo`/`wasm-pack` itself. It is a fast, hermetic assertion that
runs everywhere including on a machine mid-build, and it names the exact command to run when it
fails.

### D-E — D-5's disposition moves from "present" to "repaired", inside the generator

`generate-sbom.mjs`'s defect list is a set of probes that must all return true. Rather than deleting
D-5 (which would erase the record) or inverting its probe silently, each entry gains an explicit
disposition: `recorded` (probe must return true) or `repaired` (probe must return **false**, and the
entry carries the patch id and the evidence pointer). The generator's exit condition becomes "every
entry matches its declared disposition", so a *re*-introduction of the defect now fails just as
loudly as its repair used to. `SBOM.md` §4's heading and preamble change accordingly — the section
is no longer "recorded, **not** repaired" but "recorded, with disposition per defect", which is what
`upstream-provenance`'s own *"The known-defects record states the current disposition of each
defect"* requirement already asks for. D-1 … D-4 keep disposition `recorded` and are untouched.

### D-F — `UPSTREAM.md` records the switch as a **reversal with a reason**, not an edit

The current text ("Building from `rust/` does not become the canonical path in this Slice") is
correct for S01 and must not be silently overwritten — that is the failure mode `upstream-provenance`
names in *"the correction names which documents were wrong rather than silently overwriting them"*.
The section states what S01 decided, why it decided it, and what changed (upstream is archived; C6
needs exports that can only come from source). The toolchain table's "Only needed for the optional
wasm rebuild check" rows become required-prerequisite rows.

### D-G — `CARGO_TARGET_DIR` points at `C:`, and is documented rather than assumed

`E:` had 10.5 GB free at cohort launch against a ~2.5 GB per-worktree budget; a Rust `target/` for
this graph is several GB more. Every task that invokes `cargo` or `wasm-pack` sets
`CARGO_TARGET_DIR` to a path on `C:`. A shared target dir also makes the second and later worktrees'
builds warm, which is what keeps the toolchain requirement from taxing the whole serial spine. This
is recorded in the developer path so it is a documented step rather than tribal knowledge.

## Risks / Trade-offs

- **A stale registry copy silently satisfies imports, and every downstream child measures the wrong
  artifact.** → This is the specific reason `check-wasm-source.mjs` asserts on the *resolved* content
  with a negative control (D-D), and why it runs in both Hosts' verification, not once at the root.
- **bun copies rather than symlinks the `file:` dependency, so a rebuild does not propagate.** →
  Detected by the same content-hash assertion; the mitigation, if it occurs, is to re-run
  `bun install` after each wasm build and to say so in the developer path. Which behaviour bun 1.2.x
  exhibits is measured in task 2, not assumed.
- **Adding `rust/wasm/LICENSE` perturbs the generated manifest and weakens the correspondence
  claim.** → Handled by measuring correspondence on both sides of the LICENSE addition (D-C) so the
  delta is attributed by construction rather than discovered afterwards.
- **The Rust toolchain requirement blocks a contributor or a CI runner.** → CI already installs it on
  all three OS runners and already runs the build, so the risk is local-developer-only.
  `script/setup-rust*` covers it, and `UPSTREAM.md` already records the ~15 min cold cost and the
  ~4 minutes of *completely silent* workspace-wide Cargo resolution that reads like a hang.
- **The parity fixture moves.** → That is a **stop condition**, not a result to record. This change
  swaps an artifact source with an identical exported API; any snapshot difference means the
  artifacts are not equivalent, and the correct response is to report it, not to re-baseline.
- **The type-baseline count moves.** → Ceiling is **3**. A count above 3 or a `FAIL` stops the child
  and is escalated to the LEAD. Re-baselining is never the response, and
  `script/fixtures/type-baseline.json` is not edited. A plausible mechanism exists and is worth
  naming: `tsc` will start reading the *self-built* `opencut_wasm.d.ts` — which S01 proved
  byte-identical to the published one, so the expectation is no movement at all.
- **Write-set collision with the concurrent C1.** → C1 writes only
  `apps/web/src/editor/host/editor-host.ts` and new modules under `apps/web/src/editor/`. Nothing in
  this change's write set is under `apps/web/src/`. If that stops being true, this child **stops and
  reports** rather than proceeding — a concurrent edge is a claim, and a claim that stops holding is
  a stop condition.

## Migration Plan

There is no runtime migration; the change is an artifact-source swap with an unchanged API.

**Rollback** is a one-line revert of the two `package.json` dependency entries plus `bun install` —
the registry package remains published and installable, and nothing else in the change depends on
the swap. It stops being cheap the moment C0b lands new exports, which is the reason C0b is a
separate child and lands after this one.

**Ordering for anyone reproducing the build**: `script/setup-rust` → `bun run build:wasm` (with
`CARGO_TARGET_DIR` on `C:`) → `bun install` → Host build. That order is what CI already uses.

## Open Questions

1. **Does `wasm-pack` add copied licence files to the generated `package.json`'s `files` array?**
   Resolved by measurement B (D-C) rather than by reading wasm-pack's source. Both outcomes are
   handled; only an unattributed delta is a failure.
2. **Does bun 1.2.x symlink or copy a `file:` dependency, and does `apps/web`'s own resolution
   follow the root's?** Measured in task 2. If it copies, the developer path gains an explicit
   "re-run `bun install` after rebuilding the wasm" step and the check catches the omission.
3. **Does the installed bun (1.2.2, older than the `packageManager` pin 1.2.18 — a discrepancy
   `UPSTREAM.md` already records) handle `file:` dependencies identically?** If the lockfile churns
   beyond the two dependency entries, that churn is attributed in `PATCHES.md` the way P-015
   attributed the `configVersion` removal, not silently committed.
