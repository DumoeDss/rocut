# @opencut/editor-contracts

Domain, operations, transactions, draft sessions, the engine and conformance. Depends only
on [`@opencut/editor-ports`](../editor-ports). No React, no DOM. The transaction contract,
its draft-session leg, the engine that validates transactions, and the vectors corpus with
its Host-neutral runner — the editor's data contracts, frozen as they stood at S03+S04.

## Compatibility policy (`0.x`)

This package is versioned `0.MINOR.PATCH`. Within the `0.x` range the public surface is
partitioned into three classes — recorded per export entry in this package's
[`surface.json`](./surface.json), which ships in the tarball beside this README — and a
minor release may change **exactly what the classes permit and nothing they don't**:

| class | promise within `0.x` |
| --- | --- |
| `frozen` | contract surface. Additive-only: entries and their signatures may be added, never changed, renamed, repointed or removed. A signature change at any `0.x` version is a contract finding, not a release. |
| `provider` | OpenCut Classic convenience. May change in any minor release; will not be silently removed within a minor. |
| `experimental` | explicitly unstable. May change **or be removed** in any minor release, without a deprecation window. |

- Patch releases fix defects without any public-surface change.
- This policy is the **only** stability claim this package makes. No `1.0`, GA or
  production-readiness claim exists in any published material.
- Non-frozen entries carry their class as an `@opencutSurface` marker in the entry's
  source file; frozen entries are classified in `surface.json` alone, so the frozen
  sources themselves stay untouched.

## Surface classes in this package

10 export entries (measurement: this manifest's `exports` map read at `0.2.0`, the
`./package.json` entry excluded as mechanical):

- **frozen (9)** — the domain barrel (`.`), the draft-session surface (`./draft`) with
  its conformance suite (`./draft/conformance`), the engine (`./engine`,
  `./engine/invariant`, `./engine/conformance`), the vectors runner with its corpus
  (`./vectors`, `./vectors/corpus`), and the transaction-contract conformance suite
  (`./conformance`). This is the S03+S04 contract surface; `engine/engine.ts` is one of
  the four byte-identical frozen surfaces the portfolio's close-out control re-proves.
  (The 0.1.x manifest's eleventh entry, `./vectors/drivers`, was a mis-declaration — its
  target was authored in no commit — removed under LEAD ruling 2026-08-15; see the
  repo-level [`packages/README.md`](../README.md).)
- **experimental (1)** — `./conformance/requirements`, the requirement-index legibility
  layer over the frozen suites. Test infrastructure: it may be reorganized as the suites
  evolve, without touching the contract it indexes.

## Known constraints

None. The frozen surface of this package has no known usage constraint beyond the
policy above.
