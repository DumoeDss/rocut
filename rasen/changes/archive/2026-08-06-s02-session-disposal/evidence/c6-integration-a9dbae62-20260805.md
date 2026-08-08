# C6 integration acceptance — `a9dbae62`

## Integrated identity and conflict result

- The C6 local-ship commit `9e6a44d436b2a4fcf5c06ea975e04a41d44fab50` was cherry-picked onto the accepted C5 archive head `d6ed4166b5ffb13257d1924851f2fa57d73d349f` with no conflicts.
- Integrated commit: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`.
- Integrated tree: `885d307814260b77397c2c2677b9361fdfc5f5e2`.
- The integrated tree is byte-identical to the shipped child tree. The base-relative changed set remains exactly 98 paths.
- Tracked index and worktree were clean after all gates. Existing generated build/probe outputs remain untracked and were deliberately preserved.

## Conflict-sensitive automated gates

- C6 focused 18-file lifecycle/resource/runtime/storage matrix: **108 pass / 0 fail / 404 assertions**.
- Storage aggregate: **46 pass / 1 environment failure**. Bun 1.2.2 segfaulted while spawning the isolated `browser-project-store-migration-topology` child; the exact single-file immediate replay passed **1/1**. This is the already-recorded isolated-child runtime failure shape, not a new product-test identity.
- Session resource boundary: **714 source / 266 closure modules**; ordinary gate and every negative control pass.
- Host-port boundary: **41 modules**; ordinary and negative controls pass.
- Session-state boundary: **10/10 factories**, **10/10 keys**, **52 imperative modules**; ordinary and negative controls pass.
- Type baseline remains the exact three inherited diagnostics.
- Reference, generated-file diff, protected WASM source/path/API, inventory, SBOM, provenance, and license gates pass. Inventory remains **1,069 files / 186 modified / 114 added** with rollup `8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf`; WASM remains **38 JS exports / 58 binary exports / 609 imports**.

## Fresh production-shaped browser evidence

### Vite

- Fresh marker/base: `c6-integration-a9dbae62-vite` at `apps/vite-example/dist-c6-integration-a9dbae62-vite`.
- Build: **2,892 modules / 307 files / 35,040,817 bytes**.
- Ordinary six-cycle control is ready and clean; every class is created, released, and has zero residual.
- Missing-created and deliberate-leak controls are non-clean for the intended reason across all six cycles.
- Durable reopen is clean: one real Host/store/project, `session-1` disposed then `session-2` reopened, provider-private sentinel and attachment digest preserved, five exact residuals zero, active sessions zero.
- The owned server exited and port 4212 returned free.

### Next

- The first build attempt stopped only because the nine repository-documented example environment names were absent. Loading those exact names from `apps/web/.env.example` without logging their values produced a successful fresh build.
- Fresh marker/base: `c6-integration-a9dbae62-next` at `apps/web/.next-c6-integration-a9dbae62-next`; build id `WMqjXYTjVjdLRPpfPFvUb`.
- Build: **19/19 pages**, including `/c6-disposal`; standalone output after copying the exact generated static/public payload contains **3,033 files / 339,871,691 bytes**.
- Ordinary six-cycle, missing-created, deliberate-leak, and durable-reopen controls have the same accepted polarity and persistence result as Vite.
- The owned server exited and port 3212 returned free.

## Main-spec synchronization

- The pre-existing two-way audit in `evidence/c6-spec-sweep-20260804.md` remains the immutable review record for all 13 capability specs that existed before C6.
- After the integrated product and both Host gates were accepted, the C6 delta was synchronized to `rasen/specs/session-resource-disposal/spec.md`.
- Mechanical comparison proves exact body equality after removing only the delta heading and adding the main-spec title, purpose, and requirements heading: **14/14 requirements** and **59/59 scenarios** on both sides.
- `rasen validate --specs --strict --json` passes **14/14 main specs with zero issues**.

## Acceptance

Tasks 14.5 and 14.6 are satisfied on the integrated identity. C6 is ready for a separate Luna-xhigh archive leaf. Historical RED/prerequisite leaves 1.4–1.6 and 1.11–1.14 remain unchecked and are not reconstructed.
