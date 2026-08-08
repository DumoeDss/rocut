# C7 review round 2 fixes

Date: 2026-08-05 (Asia/Shanghai)

Scope: fix only the round-2 R1 Blocker and R3 Major. This document appends fixer evidence; it does
not replace `review-round2.md`, `verification-round2.md`, or the fresh-review requirement.

Accepted base remains HEAD `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`, tree
`885d307814260b77397c2c2677b9361fdfc5f5e2`.

## R1: canonical Next root identity

- RED: a full producer-to-checker envelope with an exact alias-only `rawRequest`, no
  `module.resource`, real named-entrypoint/chunk membership, real emitted bytes, and every required
  root was accepted by the prior producer. The new regression test failed at 4 pass / 1 fail.
- GREEN: `HeadlessWebpackGraphPlugin` now derives root identity only from the normalized, query/hash
  stripped resolved `module.resource`. Request/user-request/identifier strings remain raw provenance
  but cannot establish a root. `entry.observed` is the actual resolved resource. The same test file
  passes 5/5, including concatenated-owner membership and the full alias-only rejection.
- Files: `apps/web/build/headless-webpack-graph-plugin.ts` and
  `apps/web/build/__tests__/headless-webpack-graph-plugin.test.ts`.

## R3: field-complete runtime sensitivity

The runtime probe now publishes ordered hook provenance and separate call fields for timeout,
interval, RAF, Worker, AudioContext, webkitAudioContext, URL object URL, WebGPU adapter, both WASM
instantiate paths, four Host paths, React DOM evidence, and the derived compositor/GPU aggregate.
An existing callable is wrapped before subject execution; an actually absent hook is recorded with
its path and reason; an unpatchable hook is rejected.

The clean evaluator checks every field individually for zero, exact strategy/order/provenance,
specific-to-aggregate consistency, Host retained-state consistency, and result-summary consistency.
The sensitivity evaluator requires every installed hook to be nonzero and every evidenced absent
hook to remain zero. Browser React acceptance requires a real `createRoot`/`flushSync` render,
MutationObserver records, and a new React root marker. Server acceptance requires explicit
`server-no-dom/v1` provenance and zero DOM fields.

The browser and server negative controls are separate injected modules: Vite mounts through the
browser-only ReactDOM control, while Next imports React without pretending to have a DOM. The Host
runner accepts a React control only when the ordinary graph checker rejects solely
`forbidden.react-family`, then executes the built artifact through the sensitivity evaluator.

## Final control and clean artifacts

| Run | Output | Graph SHA-256 | Runtime result | Report SHA-256 |
| --- | --- | --- | --- | --- |
| Vite React sensitivity | `apps/vite-example/dist-c7-r2-headless-react-control-20260805-10` | `1a7cf5bcd6a426179078db94273df827c31d019e1767bfc6a5eb516fb449c65a` | PASS; 34 modules; 19 React-family issues; every installed global/Host/GPU/WASM hook nonzero; real React mutation/root | `d66942ea5910dfd6f11dc46dc6f244e60333b22f7f56d13afe2b143e4720d9b4` |
| Next React sensitivity | `apps/web/.next-c7-r2-headless-react-control-20260805-5` | `69187000e14d9500d78b85bd85c003df72ebf9e9bf5beedb60a81c76609c6845` | PASS; 19 modules; one injected React-family issue; every installed server/Host hook nonzero; explicit no-DOM absence | `00ed06adf5c086ec8300d51d56e5fc54f03260edb943bed0851dd876b5a74ce1` |
| Vite clean | `apps/vite-example/dist-c7-r2-headless-clean-20260805-3` | `6eaf3a78e5ef8a01b0b2fd3d46f6892637e9ee058bfe65ff3c266d19f1e6338c` | PASS; 15 modules; every observed field zero | `b5081b0a9d6445e25330732284959a1a8973a6fcb7a6d6f08e4b19cb4d232732` |
| Next clean | `apps/web/.next-c7-r2-headless-clean-20260805-3` | `078b16dd9d9358f27c7f2651bda83e9cb6e11c77a719d094d86a95df7ecac45a` | PASS; 16 modules; every observed field zero | `9b0bbdff678dfc6c2dd56b5012700ddd0fc0e0b12a330d54eaf4cd67a0540002` |

The independent cross-Host evaluator passed with project `c7-headless-project`, edit
`C7 headless edit`, Vite graph `6eaf3a78...`, and Next graph `078b16dd...`. Every helper-owned
server/browser process, port, and browser profile was cleaned. Next's automatic `tsconfig.json`
changes were restored by patch; final SHA-256 is
`a9b6b3497121f1da40ac2108721d3d213b5e00fb6ed2bf8f39a5867e9646c135`.

Proof-only Next Webpack persistent caching is disabled. The final Next outputs are approximately
72.6 MB each rather than generating a 1.09 GiB graph-unreferenced cache; ordinary Next behavior is
unchanged.

The port/resource static replay caught a fixer-introduced direct-acquisition regression before
handoff. The active trigger was moved out of `apps/web/src/editor/session/` and the entire product
source tree into `script/fixtures/c7-headless-runtime-sensitivity-control.ts`; the semantic fixture
now receives a proof-only callable. No boundary rule or exemption was weakened. The table above is
the post-boundary final sequence. The earlier round-2 outputs remain truthful and retained but are
superseded. One runner invocation was accidentally made before Vite output 9 was built; its failed
raw report is retained as `vite-r2-react-sensitivity-boundary-final-20260805.json`, no output-9
directory ever existed, and no product verdict was claimed.

## Failed generated attempts eligible for exact deletion

All paths below are direct, non-reparse directories created by this round-2 fixer. Raw reports are
retained in `evidence/raw/`. No accepted or previously existing output is eligible.

| Exact path | Bytes / files | Failure |
| --- | ---: | --- |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\vite-example\dist-c7-r2-headless-react-control-20260805-1` | 1,323,384 / 12 | Runtime control awaited an indefinitely pending platform promise; graph correctly rejected React. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\vite-example\dist-c7-r2-headless-react-control-20260805-2` | 1,323,430 / 12 | Default Unicode producer ordering diverged from checker canonical ordering; output-set digest rejected. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\vite-example\dist-c7-r2-headless-react-control-20260805-3` | 1,323,430 / 12 | Runtime control still blocked before the later stage probe isolated the cause. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\vite-example\dist-c7-r2-headless-react-control-20260805-4` | 1,323,564 / 12 | Runtime control still blocked; nonblocking platform calls alone did not resolve it. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\vite-example\dist-c7-r2-headless-react-control-20260805-5` | 1,325,218 / 12 | Stage evidence isolated a concurrent dynamic ReactDOM import deadlock before fixture entry. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-r2-headless-react-control-20260805-1` | 12,879,775 / 123 | Next correctly rejected the browser-only static ReactDOM control in a server route. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-r2-headless-react-control-20260805-2` | 69,727,709 / 281 | Webpack compiled, then page-data collection failed because the first retry omitted documented test environment values. |

Deletion status: all seven exact paths were revalidated as direct-child, non-reparse directories,
deleted with `Directory.Delete(exactPath, true)`, and verified absent. E: free space rose from
`596,496,384` to `684,933,120` bytes. These generated attempts are not recoverable from Git; their
raw reports and this failure record remain. Vite control 6, final control 7, final Next control 3,
both final clean outputs, every pre-round-2 artifact, and port 4174/PID 44516 were untouched.

## Regression gates

- Final focused suite: `90 pass / 0 fail / 123 expectations` across the same eight files. Relative
  to round 1, all `38` added tests and `42` added expectations pass.
- Final unfiltered Bun suite: `480 pass / 8 inherited fail / 2 inherited loader errors / 1,417
  expectations / 488 tests / 83 files / 43.45s`. The six named
  `resolveTrackPlacement`/`ZERO_MEDIA_TIME` cases and the two accepted loader-error identities are
  unchanged; the pass/test/expectation deltas exactly equal the new round-2 tests.
- Vite typecheck passes. `check-type-baseline` passes with only the exact three inherited
  diagnostics. Targeted ESLint has zero errors (four expected ignored-file warnings), Prettier and
  `git diff --check` pass, and both modified `.mjs` entrypoints pass `node --check`.
- Static boundaries all pass: session state `10/10` and `52` classified imperative modules;
  session resources `722` source / `266` frozen with all seven rules zero; port `53`; storage
  `738`; Host composition `2` roots / `735` production modules; runtime assets `737`; reference
  `4,112/7,712` applicable/enumerated files; Next imports `808` source / `25` allowlisted shell
  importers and zero editor-graph imports.
- `bun run check:wasm` passes source/freshness/license/wiring, privacy negatives, and exact `38` JS
  exports / `58` binary exports / `609` imports. Rust passes `12/12` plus doc tests with
  `CARGO_TARGET_DIR=C:/Users/Sayo/cargo-target`.
- Protected editor ports, session types, parity/type fixture, Rust/WASM, GPU/compositor trees and
  generated JS/WASM identities exactly equal the cold baseline; protected `git diff --quiet` and
  status are clean. Port `4174` remains PID `44516`.
- Rasen strict validation passes the child `1/1` and all main specs `14/14`, zero issues.

This fixer does not self-certify. Tasks 12.6-12.8 remain reviewer-owned and unchecked; a third
fresh Sol-xhigh reviewer remains required.

## Superseded initial/round-1 output reclamation

Before any further build, E: had only `531,374,080` free bytes. LEAD authorized deletion of
initial and round-1 C7-generated outputs only after their exact identities and historical results
were durably recorded and a later artifact was shown to occupy every live acceptance role. The
current round-2 Vite/Next clean and React-control outputs remain intact. The accepted ordinary Next
role remains at `.next-c7-ordinary-regression-20260805-3`; all ordinary regression/parity outputs
still needed for review are retained. The cold baseline's durable role is the immutable accepted
HEAD/tree and the hashes in `baseline-20260805.md`, not a generated `.next` directory.

Each directory identity below is SHA-256 over ordinal-sorted entries
`relative/path NUL byte-length NUL file-SHA-256 LF`. Thus the record binds every removed relative
path and byte, including files outside a headless graph. `Graph SHA` is the raw
`c7-headless-graph.json` SHA-256 where present. Every target and descendant had zero reparse points
at measurement time.

| Exact worktree-relative directory | Bytes / files | Directory identity | Graph SHA / build identity | Historical result and supersession |
| --- | ---: | --- | --- | --- |
| `apps/vite-example/dist-c7-headless-clean-20260805-1` | 169,486 / 4 | `b381b926ccdf8df568d1ca8a6b72aaf3c19ae91aca83e9b491c4978afc459561` | `7d130f1192658258f286df376edf93f89240473a19b6b8fa5555d7f322effad4`; `vite:c7-vite-headless-clean-20260805-1:f429c5edff0d957d` | Clean graph; browser run exposed the favicon 404. Superseded first by initial attempt 2 and then by round 2. |
| `apps/vite-example/dist-c7-headless-clean-20260805-2` | 169,547 / 4 | `2fa39431931f9a1e7fda5fc9f0ed98594f1c8b8abbf800e138f42e6e556a06c3` | `78b16bbe7df5a55d85974c61f8dd89569b33c6b69e29fddecf708d16f650cc7d`; `vite:c7-vite-headless-clean-20260805-2:47bef2a6df57e1c4` | Initial accepted clean proof, superseded by the round-1 and round-2 clean proofs. |
| `apps/vite-example/dist-c7-headless-react-control-20260805-2` | 208,283 / 4 | `be7b5c6573576f07d6917f34606bbb63a133f9bd506b50d43addec1a7c1add9f` | `b8dd90d69be01c4d7385f69d9f08b65683d2c7abb9b37937b1c67e6a1c52dbd8`; `vite:c7-vite-react-control-20260805-2:3de445cddc6421d6` | Initial React negative control, superseded by the field-complete round-2 sensitivity control. |
| `apps/vite-example/dist-c7-r1-headless-clean-20260805-1` | 197,469 / 6 | `187b90b1f90ad8b8b4acef0e64605dabae1541446a99d94123d0616fbb5bd728` | `29538ca0fcfd71f8b102e8ff18531566804c37731917d8f0474aad7e3e3bf43f`; `vite:c7-vite-r1-headless-clean-20260805-1:64a9793654f1b34b` | Round-1 intermediate; no final acceptance claim. Superseded by attempts 2/3 and round 2. |
| `apps/vite-example/dist-c7-r1-headless-clean-20260805-2` | 197,685 / 6 | `4240c122d63ae975c8e26e0bcaf23f75dbc423e1e4efdc33b1cb8c755504168f` | `37e15816416b7720ca36613841d43ac8d2a95c7088e905d2ea7ffdba0fa0174c`; `vite:c7-vite-r1-headless-clean-20260805-2:28f24629d0f029b7` | Clean graph/runtime PASS, later source-format bytes superseded by attempt 3 and then round 2. |
| `apps/vite-example/dist-c7-r1-headless-clean-20260805-3` | 197,692 / 6 | `4bd7f3cc45dd9c3be8fc4ef075e6fd97064fcd548fcc9b2c6bd73b4786303618` | `eeda71ecf1217b0f287765333a16d78f757b60bb910ce4b2f8a39bb7810d8932`; `vite:c7-vite-r1-headless-clean-20260805-3:1bd1cb6537f02324` | Final round-1 clean graph/runtime PASS, superseded by round 2. Raw report remains. |
| `apps/vite-example/dist-c7-r1-headless-react-control-20260805-1` | 236,134 / 6 | `f66465ff8c0b975360b8a5f124f1d5d7456247a6998f38179bc6a081bc7f343c` | `7769dca21841ac9cd9e00358eaa510cda39716dee0afaa2e4e471bf3021ad397`; `vite:c7-vite-r1-react-control-20260805-1:e2e3d565b85dac4d` | Round-1 intermediate; no final acceptance claim. Superseded by attempts 2/3 and round 2. |
| `apps/vite-example/dist-c7-r1-headless-react-control-20260805-2` | 236,350 / 6 | `18f48dc55e2dfadf7678339947b73e1e492007ca76cc821e751dee96c2a254a5` | `1034e9f9924196190da905dacc7bc5441b861e10d2d42eb009b4e30712361acf`; `vite:c7-vite-r1-react-control-20260805-2:da649d7506491d5f` | React-only negative-control PASS, later source-format bytes superseded by attempt 3 and then round 2. |
| `apps/vite-example/dist-c7-r1-headless-react-control-20260805-3` | 236,357 / 6 | `eb5431117fd577e35a5667c35d84c82782861efca73ef68e868e55e2ebe7408a` | `6c6bff36576ae89ccaab7b17b433209e540b7e63ba34a56b3b2774aa61f5097d`; `vite:c7-vite-r1-react-control-20260805-3:8ec7fb8a9a7f9117` | Final round-1 React-only negative-control PASS, superseded by round 2. Raw report remains. |
| `apps/web/.next-c7-headless-clean-20260805-1` | 72,484,061 / 408 | `32b14d17176274971c37af83322005654f8092a0d66ffdcbe8b16d72512af91a` | `2f5e3d8bbd21f3c2095606ef995dd6958ecaae4f5026c8759f0258e708b2e062`; `next-webpack:0e4af95144cec01c` | Initial clean graph/runtime PASS, superseded by round 1 and round 2. |
| `apps/web/.next-c7-headless-react-control-20260805-7` | 72,506,405 / 408 | `94d6b3a84385b72f0924679bcf22bbf8d01a265546ff6fe1f1c8310015a987db` | `02a5d5ffcf7159ce85941bbdb23a6de8abf77e4017e28be6ef5cd8f7b9f930e8`; `next-webpack:22647de5e357d25d` | Initial React-only negative-control PASS, superseded by the field-complete round-2 control. |
| `apps/web/.next-c7-r1-headless-clean-20260805-1` | 72,496,469 / 409 | `c928702af928476c77dcb6b044847a30a19cf7990b895fcbb21a6d615cae1ff3` | `306f17cdf33243bc3d8f598305421af337ba021f05faee590ab0d73fff897099`; `next-webpack:5914609b30a0d9ee` | Round-1 clean graph/runtime PASS, superseded by final round-1 and round-2 clean proofs. |
| `apps/web/.next-c7-r1-headless-clean-20260805-2` | 72,502,616 / 409 | `0b03cb2ba81643eaa495501ac578c1bd185484393abd334aac8d6d916fb68b35` | `b32ac37ff3f9c9139eafec67b730e89a23fed2ba171579bfbe39364a19b9040c`; `next-webpack:c405e64dd0c5ae11` | Final round-1 clean graph/runtime PASS, superseded by round 2. Raw report remains. |
| `apps/web/.next-c7-r1-headless-react-control-20260805-1` | 72,502,397 / 409 | `f601fea9236683d6e5193c58916a714875f1bd167d03ba6007cdf9f4d7c20927` | `d70cd8a2f20e6a18c97e142bb0f9da3a9ec48ef6660ae6d8ba3d491439ce82ff`; `next-webpack:d962f1bdd48d8d8d` | Round-1 injected-React negative-control PASS, superseded by final round-1 and field-complete round-2 controls. |
| `apps/web/.next-c7-r1-headless-react-control-20260805-2` | 72,506,127 / 409 | `4f4162d38cd3b03edb3b361c7e0815a92300c9ef3f60b20e554957e85e984866` | `c2332f859bddeec7e0c81ba9f9eb433d89ea80b4bacef821aaa3055494765a01`; `next-webpack:30e5142eda97039c` | Final round-1 injected-React negative-control PASS, superseded by round 2. Raw report remains. |
| `apps/web/.next-c7-ordinary-regression-20260805-2` | 247,650,051 / 2,614 | `de58b40e434148125369b1e79bc80927be0e18fafe928b1f5c85b3accdbe792e` | Next build ID `DkW9CUEa0fTuY6syMKlmD` | Successful `19/19` ordinary Turbopack build, but it lacked the unique browser marker and was never the Host-oracle artifact. Attempt 3 remains the accepted ordinary output. |
| `apps/web/.next-c7-baseline-20260805-attempt2` | 247,260,886 / 2,591 | `bc297ac8e6e1163458467218799e757cc800303bf78d567370f1ff3064dd7f66` | Next build ID `rErLi3qUFrFBM3IkzLcUx` | Successful pre-edit cold baseline prerequisite only; it carries no live acceptance verdict. Accepted-base Git/tree and protected hashes remain durable, while later ordinary and round-2 artifacts cover live build roles. |

Deletion status: all 17 literal directories were remeasured, resolved beneath this worktree,
validated as direct children of the named Vite/Next output roots with no target or descendant
reparse point, then deleted one-by-one with `Directory.Delete(exactPath, true)` and verified absent.
The exact total was `931,758,015` bytes / `7,705` files; E: free space rose to `1,481,011,200`
bytes. This is nonrecoverable from Git. Source, tests, raw JSON, all Rasen evidence, every current
round-2 control/clean output, retained ordinary/parity outputs, and port `4174`/PID `44516` were
rechecked present and untouched.
