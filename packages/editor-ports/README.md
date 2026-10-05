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

### Approved draft-review exception: ports 0.3.0 / contracts 0.4.0

The project owner explicitly approved this one-time frozen-contract revision on
2026-10-06. It is **not** a backward-compatible patch or permission to change any
other frozen surface. The revised draft transport is frozen again under the policy
above. It removes the forbidden ports-to-contracts dependency cycle; ports remains
dependency-free. The Rocut plugin version is independent of these SDK versions.

- `DraftReviewItem<State = string>` carries a generic lifecycle string.
- `DraftReviewDocument<Snapshot = unknown, Review = unknown>` carries opaque data.
- `DraftReviewPort<Snapshot = unknown, Review = unknown, State = string>` preserves
  the list/read/decide methods, argument names, promises and approval tokens.
- `EditorHostBase.draftReview` accepts the generic transport. Code reading its
  response directly must refine it before using domain properties.

Domain-aware consumers should change the type import to:

```ts
import type {
  DraftReviewDocument, DraftReviewItem, DraftReviewPort,
} from "@opencut/editor-contracts/draft";
```

These aliases preserve the domain snapshot, summary and lifecycle types.
For a generic Host transport, use `createValidatedDraftReviewPort` from that same
entry before reading domain responses. It retains the existing HTTP envelope and
identity checks; it is not a replacement for the engine's project/schema checks.
Implementations can also explicitly specialize the generic types from ports.

The HTTP JSON payload, opaque review fingerprint, server-side approval/conflict
authority, project format and runtime list/read/decide protocol are unchanged.
Consumers that only implement transport forwarding need no runtime migration.
Do not cast an unvalidated unknown payload to bypass the boundary.

### Export inventory

7 export entries (measurement: this manifest's `exports` map read at `0.3.0`, the
`./package.json` entry excluded as mechanical):

- **frozen (5)** — the port contract barrel (`.`), the Host port surface (`./host`), the
  in-memory reference implementation (`./in-memory`, `./in-memory/host`) and the port
  conformance suite (`./conformance`). This is the S02/S03+S04 contract; the whole
  package exists to be implemented, not consumed as a convenience.
- **experimental (2)** — `./conformance/requirements`, the requirement-index legibility
  layer over the frozen suite, and `./export-jobs`, the experimental job lifecycle.
  Their evolution does not alter the frozen contracts they accompany.

## Known constraints

Draft-review consumers of ports 0.2.0 must apply the explicit source migration
above when adopting 0.3.0. Other frozen surface promises remain unchanged.
