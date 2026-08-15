# @opencut/editor-ports

The Host port contract a Host author implements. Zero dependencies, no React, no DOM.
Everything a Host must provide the editor — persistence, assets, workers, export,
diagnostics, ids, graphics environment — is declared here as ports, with an in-memory
reference implementation and a conformance suite to validate an adapter against the
contract.

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

6 export entries (measurement: this manifest's `exports` map read at `0.2.0`, the
`./package.json` entry excluded as mechanical):

- **frozen (5)** — the port contract barrel (`.`), the Host port surface (`./host`), the
  in-memory reference implementation (`./in-memory`, `./in-memory/host`) and the port
  conformance suite (`./conformance`). This is the S02/S03+S04 contract; the whole
  package exists to be implemented, not consumed as a convenience.
- **experimental (1)** — `./conformance/requirements`, the requirement-index legibility
  layer over the frozen suite. Test infrastructure: it may be reorganized as the suites
  evolve, without touching the contract it indexes.

## Known constraints

None. The frozen surface of this package has no known usage constraint beyond the
policy above.
