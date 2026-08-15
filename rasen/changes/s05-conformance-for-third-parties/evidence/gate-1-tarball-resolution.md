# Gate 1 — pack + tarball resolution (tasks 1.1–1.3)

Date: 2026-08-15. Machine: Windows 11, npm 11.9.0, node v24.14.0, bun 1.2.2.
Raw pack output: `gate-1-pack-output.log` (this directory). Scratch spikes (throwaway,
deleted after evidence capture): `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\opencut-scratch-p3-spike`
(npm) and `...-spike-bun` (bun) — E:-drive siblings of the repo, outside the repo tree,
outside any Temp path (`TEMP`/`TMP` both `C:\Users\Sayo\AppData\Local\Temp`; the spike
roots never sit under it).

## 1.1 Pack (npm pack, all three packages)

Command shape (run from each package dir, output to the gitignored `dist-sdk-tarballs/`
at repo root; `.gitignore` gained the `dist-sdk-tarballs/` entry in this change's group-1
commit):

```
cd packages/<pkg> && npm pack --pack-destination ../../dist-sdk-tarballs
```

npm's own notices, recorded verbatim in `gate-1-pack-output.log` with self-logged
`REAL_EXIT_CODE[<pkg>]:0` per package:

| package | tarball | files | package size | unpacked | shasum |
| --- | --- | --- | --- | --- | --- |
| @opencut/editor-ports | opencut-editor-ports-0.1.0.tgz | 19 | 49.0 kB | 174.9 kB | 6ad1a4be9ab884295dbd9ae7ecdbf36d064b4e59 |
| @opencut/editor-contracts | opencut-editor-contracts-0.1.0.tgz | 55 | 123.5 kB | 580.3 kB | 5cefb37e73a2d76e03124b53b88c885c489fc5a2 |
| @opencut/editor-classic | opencut-editor-classic-0.1.0.tgz | 802 | 874.0 kB | 3.9 MB | a17ac13825825062792734f518e84083de75fd48 |

Method/measurement point: the table transcribes npm's `notice` lines from
`gate-1-pack-output.log`, captured 2026-08-15 at HEAD `8248a115`. The proposal-time
editor-contracts figures (55 files, 580.3 kB unpacked) reproduce exactly.

`workspace:*` verbatim check — `tar -xzOf <tarball> package/package.json` of each:

- editor-contracts carries `"@opencut/editor-ports": "workspace:*"`
- editor-classic carries `"@opencut/editor-ports": "workspace:*"` and
  `"@opencut/editor-contracts": "workspace:*"`

Confirmed: the protocol rides verbatim; this is the problem the gate exists to solve.

## 1.2 Resolution spike

Scratch `package.json` (both mechanisms, identical):

```json
{
  "name": "scratch-spike",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@opencut/editor-ports": "file:tarballs/opencut-editor-ports-0.1.0.tgz",
    "@opencut/editor-contracts": "file:tarballs/opencut-editor-contracts-0.1.0.tgz",
    "@opencut/editor-classic": "file:tarballs/opencut-editor-classic-0.1.0.tgz"
  },
  "overrides": {
    "@opencut/editor-ports": "file:tarballs/opencut-editor-ports-0.1.0.tgz",
    "@opencut/editor-contracts": "file:tarballs/opencut-editor-contracts-0.1.0.tgz"
  }
}
```

### (a) npm install + overrides — RESOLVES

```
npm install            # REAL_EXIT_CODE:0 — "added 3 packages, and audited 4 packages in 6s"
```

- `package-lock.json` records `node_modules/@opencut/*` with
  `resolved: file:tarballs/<tarball>` and `link: false` for all three — no registry, no
  workspace resolution.
- `lstatSync` over each installed `node_modules/@opencut/*`: `symlink: false`,
  `isDirectory: true` — real directory copies (control 2's method).

### (b) bun install + overrides — RESOLVES

```
bun install            # REAL_EXIT_CODE(bun-install):0 — 3 packages installed
```

- Same `lstatSync` result: real copies, no links.
- `bun.lock` records `"@opencut/editor-classic": "file:tarballs/opencut-editor-classic-0.1.0.tgz"`
  and shows the override replacing the nested `workspace:*` declarations with the same
  `file:` tarball specs.

Neither mechanism was rejected for resolution failure — npm is chosen (see 1.3).

## Runtime probe (bun 1.2.2 runs the TS-shipped tarballs natively)

`probe.ts` imports all five suite entries + `openTransactionEngine` + the migration
surface. Result under BOTH mechanisms, identical:

```
error: Cannot find package 'culori' from
  '...\node_modules\@opencut\editor-classic\src\services\storage\migrations\transformers\v21-to-v22.ts'
REAL_EXIT_CODE: 1
```

Scope probe (`probe-noclassic.ts`, same scratch): every port/contracts entry —
`runPortConformance`, `runTransactionConformance`, `runDraftEditingConformance`,
`runTransactionEngineConformance`, `runTransactionVectors`,
`loadTransactionVectorCorpus`, `openTransactionEngine` — imports and resolves from the
installed tarballs alone. `REAL_EXIT_CODE: 0`.

## The measured blocker: editor-classic's migration surface has phantom dependencies

`@opencut/editor-classic`'s manifest declares only the two workspace deps. Its runtime
import closure (static `import`/`export … from`, `import type` erased — the method the
runner itself would execute) reaches three packages no manifest declares:

| bare dep | reachable from | reachable how | installable outside the monorepo |
| --- | --- | --- | --- |
| `culori` | `migrations/transformers/v21-to-v22.ts` (1 import) | `converter, parse` | registry (`^4.0.2` declared only by `apps/web`) |
| `opencut-wasm` | `migrations/v27-to-v28.ts` → `transformers/v27-to-v28.ts` → `wasm/index.ts` → `wasm/media-time.ts` | MediaTime conversions | **local `file:./rust/wasm/pkg` build (v0.2.10, 3.3 MB wasm) — on no registry** |
| `react` | `storage/index.ts` re-exports `use-storage-persistence.ts` | a React hook inside the `./storage` barrel | registry (18.3.1 at root) — but the third-party story says "without pulling React" |

Runtime-only closure of `migrations/index.ts`: 70 files; of the whole `./storage` barrel:
83 files. `editor-ports` and `editor-contracts` closures: **zero bare third-party
imports** (the one grep hit in ports is prose in a comment).

This is mechanism-independent: npm and bun both install everything declared; nothing
declares `culori`/`opencut-wasm`/`react` for classic, so both probes fail at module
resolution.

## 1.3 Mechanism decision

**Chosen: (a) npm install with `overrides` mapping each cross-package `@opencut/*` name
to `file:<tarball>`.** Reasons: npm is the pack tool (one package manager owns the
manifest/tarball lifecycle); overrides are npm-native; the lockfile's `file:` +
`link:false` records give control 2 its oracle for free; bun remains the runtime (the
tarballs ship TypeScript — only a TS-capable runner executes them, and the repo's own
convention is `npx --yes bun@1.2.18 test`). Mechanism (b) measured equivalent for
resolution and kept as the recorded fallback; neither failed, so no rejection text
exists for a resolution failure — the failure text above belongs to the separate
phantom-dependency finding, not to either mechanism.

**Escalation (open, per design E3's "manifest fix is a decision, not a private patch"
discipline):** the `workspace:*` question the gate was built for is settled, but the
from-tarballs leg of the worked adapter (tasks 5.4, 6.2) cannot run
`@opencut/editor-classic/storage` until the phantom-dep finding is ruled on. Options
presented to the LEAD with this evidence:

1. Declare `culori` in editor-classic's manifest + have the harness pack
   `rust/wasm/pkg` as a fourth tarball with an `opencut-wasm` override (all local, no
   registry); react reached via the barrel stays — declare it too, or accept the
   consumer's hoist.
2. Add a narrow attributed entry `@opencut/editor-classic/storage/migrations`
   (monotone addition) exporting only `migrations` + `CURRENT_PROJECT_VERSION` —
   avoids the react-carrying barrel but still needs culori + opencut-wasm solved.
3. Re-scope the adapter's migration leg off classic (its own transform chain) — a spec
   letter change ("the published migration artifacts"), not an implementer call.

No code was patched while awaiting the ruling; groups 2–3 (ports/contracts entries and
indices) proceed — both packages verified fully consumable from tarballs.

Throwaway scratch directories deleted after evidence capture.

## LEAD ruling

Received 2026-08-15 from team-lead, verbatim:

> RULING — option (1)+(2) combined. The principle: classic's manifest must stop lying about its closure, AND the third-party adapter gets a react-free migration surface. Four sub-decisions:
>
> 1. **culori → `dependencies` of classic.** It is an implementation detail of a published transformer; consumers must not need to know it exists. Version: whatever the lockfile actually resolves today (match repo pinning convention; exact pin preferred). It installs from the registry in the scratch project — that is legal under B1 (we publish nothing; the CONSUMER fetching a real third-party dep from npm is normal package behavior).
>
> 2. **react → `peerDependencies` of classic** (`^18.3.1`). NOT a hard dep — a second React copy breaks hooks; every Host already declares its own 18.3.1, so the peer is satisfied everywhere in-repo. This is the honesty fix for the existing `./storage` barrel's react import; it does not gate the adapter.
>
> 3. **opencut-wasm → declared dependency of classic** (declare it the way the monorepo actually resolves it today — do not change in-repo resolution semantics), and the harness packs `rust/wasm/pkg` as a FOURTH local tarball with an `opencut-wasm` override mapping. No registry publish of the wasm package (B1); the override is the control that makes resolution honest.
>
> 4. **Add the attributed entry `./storage/migrations`** (option 2). Forcing module to name in the record: the third-party adapter's react-free migration conformance. This is monotone growth under P1's rule — update `packages/boundary.json` + the checker's declared-entry fixtures to match, and record the entry's addition + forcing module in BOUNDARIES.md at close-out (the sdk-package-extraction requirement's attributed-growth protocol; no spec delta edit needed).
>
> Verification this ruling adds beyond the existing boxes:
> - **Prove the react-free property of `./storage/migrations`** from tarballs: a probe (sub-project without react installed, or a module-graph closure assertion — your choice, stated in evidence) showing the entry's closure contains no react specifier.
> - Re-verify all three in-repo Hosts still resolve after the manifest change (their existing react declarations satisfy the new peer; run each Host's typecheck/build gate, not just install).
> - The scratch-project adapter then exercises migration through `./storage/migrations` from installed tarballs — tasks 5.4/6.2 unblocked on that surface.
>
> REJECTED: option 3 (re-scoping adapter migration off classic) — the adapter consuming the PUBLISHED migration chain is the SDK-consumption story itself; independent replication would drift from the published versions and gut §3.5's point.
>
> Record this ruling verbatim in `evidence/gate-1-tarball-resolution.md` (a "## LEAD ruling" section) and carry the gate finding as a durable finding in your DONE: **P1 shipped classic with a manifest that understates its runtime closure — invisible under workspace resolution, caught only by the tarball harness; P5 (versioning/labeling) and P6 (examples) inherit this manifest-truth obligation.** Continue with groups 2–4 as you planned; the classic manifest work lands when 5.4 needs it.

Execution of this ruling is recorded under "Group 9" in `implementation-report.md`
(the change had already delivered groups 1–8 when the ruling arrived; the migration
leg had shipped as finding + walker-validation, which this ruling replaces with the
real fix).
