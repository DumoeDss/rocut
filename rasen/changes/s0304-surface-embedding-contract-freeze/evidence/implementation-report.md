# Implementation report — `s0304-surface-embedding-contract-freeze`

**Recovery date:** 2026-08-10  
**Schema:** `spec-driven`  
**Progress:** 15/15 tasks complete  
**Result:** R0 contract recovered exactly and verified.

## Product result

Only two product files were added, both under the owned R0 directory:

| Path | Transcript record | UTF-8 bytes | SHA-256 | Git blob |
| --- | ---: | ---: | --- | --- |
| `apps/web/src/editor/surface/embedding/types.ts` | 79 | 12,969 | `191d8ce880dc4807c90f8ff9113333c4e6992d1e4274bcc756a62a6cad3d5379` | `5bbfc48d3a1dc0af71275ce1dccad71df0f2d167` |
| `apps/web/src/editor/surface/embedding/index.ts` | 83 | 419 | `81a514fa12be1e5d19d25d816f13de3a9122de61771df1de0c1abe6c844cb313` | `bfbf6f6fdb54813d5c9d252cbb5bdc0ca385e57a` |

The files are the exact UTF-8 `Write.input.content` payloads from the preserved
implementation transcript. They were not retyped, formatted, modernized, or
semantically recreated.

The contract preserves both frozen decisions:

- A1: `SurfaceCommitBinding.commit(args: { edit: unknown }): void` remains an
  opaque Surface-local seam; no transaction/domain type is imported or named.
- A2: R0 wires no React runtime and does not claim React ownership. Shared React
  remains R2 work.

No component body, event listener, CSS, Host port, command, transaction, or
session implementation is added by R0.

## Historical tree proof

Static transcript records 52 and 241 establish the original implementation
base as `d84d9d50b718aa3c85c76ec762febcb5db0286ff`. A temporary Git index, never the
repository index, was populated as follows:

```text
GIT_INDEX_FILE=<temp> git read-tree d84d9d50^{tree}
GIT_INDEX_FILE=<temp> git update-index --add --cacheinfo 100644,5bbfc48d3a1dc0af71275ce1dccad71df0f2d167,apps/web/src/editor/surface/embedding/types.ts
GIT_INDEX_FILE=<temp> git update-index --add --cacheinfo 100644,bfbf6f6fdb54813d5c9d252cbb5bdc0ca385e57a,apps/web/src/editor/surface/embedding/index.ts
GIT_INDEX_FILE=<temp> git write-tree
```

Results:

- base tree: `3d7c5e3a76db7665f5571723f72e40d2388c88ce`
- reconstructed tree: `3e1cce7fc0e95e4221d1911b558167408198378a`
- delta: exactly the two added files above
- live index SHA-256 before and after:
  `7c4ba0c82f16d54102af5d884a056effa1797a45b7b261e6c83de9dfe3e9dfbf`

No branch, ref, or live index was changed by reconstruction.

## Verification

| Check | Result |
| --- | --- |
| `rasen instructions apply --change s0304-surface-embedding-contract-freeze --project rocut --json` | PASS — `all_done`, 15 complete, 0 remaining |
| `rasen validate s0304-surface-embedding-contract-freeze --strict --project rocut --json` | PASS — 1 passed, 0 failed, no issues |
| scoped product status under `apps/web/src` | PASS — only `embedding/index.ts` and `embedding/types.ts`; no product entry outside the owned directory |
| focused TypeScript with the declared three-error baseline | PASS — first run reproduced only the declared `EyeDropper` ×2 and `soundtouchjs` ×1 baseline; adding the repository ambient declarations produced 0 diagnostics |
| `bun x tsc --noEmit -p apps/vite-example/tsconfig.json` | PASS — 0 diagnostics |
| focused ESLint on the two recovered files | PASS with 0 errors and 1 warning — the transcript-exact unused type import `EditorSessionRootHandle`; not altered because exact bytes are authoritative |
| current integrated Next Host build | PASS — compiled, collected page data, generated 19 static pages; used the repository's documented non-secret CI placeholders |
| current integrated Vite Host build | PASS — 2,920 modules transformed; existing chunk/import warnings only |
| exact historical tree Next Host build | PASS — compiled and generated 19 static pages |
| exact historical tree Vite Host build | PASS — 2,893 modules transformed |
| exact historical tree Vite parity | PASS — 1/1 Playwright scenario |
| exact historical tree Next parity | PASS — 1/1 Playwright scenario |
| exact historical snapshot comparison | PASS — 9 incidental, 0 semantic differences across 195 leaf values, matching committed `PARITY.md` |
| spec-falsification sweep | PASS — 0 assertions falsified; see `evidence/spec-falsification-sweep.md` |

Historical parity artifact hashes before temporary cleanup:

- Vite snapshot:
  `a49213df4f9d4f55b36f0a34dddd24238cc7e6bb588f5f7742a1909b157fd9bd`
- Next snapshot:
  `0e3813b4fccc2eb3a8b5a3b04b2d8adafb17a3e5408e03cd17d9011147fd3ed6`
- generated comparison report:
  `6957a986b99f410110d1075de7d7e2203e93103d63bbfc4827dc44ee60c1a650`

## Integrated-tree observations and limitations

The current checkout is an integrated recovery branch at
`95cb64538e12a6d35675af50fb0de5766e12c4a5`, not the original R0 base.
Accordingly, broad current-tree gates contain later unrelated state:

- `bun x tsc --noEmit -p apps/web/tsconfig.json` currently fails on the
  integrated tree because test files cannot resolve `bun:test`/`Bun`, the root
  and `apps/web` installations expose incompatible Next type identities, and
  Vite's `ImportMeta.env` declaration is absent from the Web config. There are
  no diagnostics under `surface/embedding`; the focused R0 gate is green.
- Both current-tree Host parity scenarios pass, but their newly generated
  cross-Host comparison has 20 semantic differences in later
  `__opencutTransaction.idempotency` state plus the established 9 incidental
  layout differences. The recovered R0 module has no runtime reference outside
  its own directory. Running the exact reconstructed R0 tree removes those
  later transaction fields and reproduces the committed 9/0/195 baseline.
- The machine had an unrelated user process bound to IPv4 loopback ports 3000
  and 3001. Next bound IPv6 loopback, so parity was rerun against verified
  `[::1]` endpoints. The user process was preserved.
- The original 15-spec sweep included three concurrent, untracked spec
  directories. The exact Git base contains 12 specs and the current tree 13;
  original records 199–210 preserve the full 15-spec search and named reads.

## Durable findings

1. Exact transcript recovery is strongest when the UTF-8 payload is turned into
   a Git blob and proven through a temporary index/tree before checkout.
2. On Windows, an IPv4 listener can coexist with a Next IPv6 listener on the
   same port; browser probes must verify the exact address family before parity.
3. Turbopack rejects a dependency junction that crosses its filesystem root;
   an isolated exact-tree build must keep source and dependency targets inside
   the inferred workspace root.
