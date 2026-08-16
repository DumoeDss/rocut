# Contracts surface before snapshot

Date: 2026-08-16

Source commit: `661d7ac87c3d324839d51bf30470bbf81764b694`

This is the reproducible before half for the later additive-only, version, and
frozen-byte checks.

## Manifest identity

- Package: `@opencut/editor-contracts`
- Version: `0.2.0`
- `package.json` Git blob:
  `e78d521ed2f57619830e759e9262b150e2fb8b00`
- `package.json` SHA-256:
  `f6d89193ede2eecfe69e04f88ef5927e034cf290dbfcf37b5189a86292b82fca`
- `surface.json` Git blob:
  `bc068001bea2d54c54e292daf35e9575d6dec027`
- `surface.json` SHA-256:
  `2e7f25bccebf2559bd16cc8b9894818d9b9858715be659bc05653a80ade1812e`

Reproduce Git identities with
`git rev-parse 661d7ac8:<path>` and working-file digests with
`Get-FileHash -Algorithm SHA256 -LiteralPath <path>`.

## Export map

`./package.json` is mechanical and excluded from the class census.

| export | target | before class |
| --- | --- | --- |
| `.` | `./src/index.ts` | frozen |
| `./conformance` | `./src/conformance/index.ts` | frozen |
| `./conformance/requirements` | `./src/conformance/requirements/index.ts` | experimental |
| `./draft` | `./src/draft/index.ts` | frozen |
| `./draft/conformance` | `./src/draft/conformance/index.ts` | frozen |
| `./engine` | `./src/engine/index.ts` | frozen |
| `./engine/invariant` | `./src/engine/invariant.ts` | frozen |
| `./engine/conformance` | `./src/engine/conformance/index.ts` | frozen |
| `./vectors` | `./src/vectors/index.ts` | frozen |
| `./vectors/corpus` | `./src/vectors/corpus/index.ts` | frozen |
| `./package.json` | `./package.json` | mechanical |

Before census: 10 non-mechanical entries = 9 frozen + 1 experimental.

## Portfolio frozen-file identities

These are the four S03+S04 frozen files used by the standing byte-identity
control. Both a Git blob identity and a SHA-256 digest are captured so the final
check can distinguish repository content from checkout encoding behavior.

| path | Git blob at `661d7ac8` | SHA-256 |
| --- | --- | --- |
| `packages/editor-classic/src/editor/transactions/opencut/index.ts` | `40862cca34f7128dc12b7114efe9db7233778659` | `24f01d2231363d9d5edbe013262e1aeb3794b3ae967f90b49c00b83dc59cb1fa` |
| `packages/editor-contracts/src/engine/engine.ts` | `b29d2f7588b9f691b3f8890ed274ba3669d42049` | `7575b63ceec9d809776dd3fc3e37a3c2f1ad147ee614c097b0ad5fac137212a4` |
| `packages/editor-ports/src/index.ts` | `87c19d8e335e74cdc225a303274e5b810c413455` | `cb747ee83ed1accd5bf9ad94dc87d023eed8a5845480c8960b9c54b34e05cdb9` |
| `packages/editor-classic/src/editor/surface/embedding/types.ts` | `52f1ec78da16a598d5433719362c5938d23c5636` | `bfdd9f888bab76ce0ae28a55e4ab0d5391b96fa9286df1ff3661de2c61cb6bee` |

The planned helper is additive and must not alter any of these identities.
