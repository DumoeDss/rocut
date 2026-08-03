# C5 section 7 — opaque coordinator round-trip evidence

Date: 2026-08-02

## Product surface

The section adds only `apps/web/src/editor/persistence/**`:

- `SessionPersistenceCoordinator` is a session-owned translator above the accepted `ProjectStore`; it imports no browser storage API or service implementation.
- `decodeProject` returns the known OpenCut projection while the coordinator retains a separate `structuredClone`-compatible complete payload.
- `encodeProject` overlays project/metadata/scene/track/clip fields by stable identity. The generic attachment/library overlay applies the same identity rule to media metadata and identified library members.
- An identified deletion removes the retained member and its private siblings. A new or changed id starts without the former member's retained subtree.
- Project, attachment, and library writes serialize by logical key. Cache/snapshot/listener publication occurs only after the accepted store operation resolves.
- Each coordinator owns its snapshot maps, cache, listeners, and pending-key map. Multiple coordinators may share one committed store without sharing those live values.

No consumer, Host root, public port, browser mechanism, boundary fixture, or session public shape was edited by section 7.

## Focused proof

Command:

```powershell
$env:OPENCUT_C5_COORDINATOR_ISOLATED='1'
bun test apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts
```

Result: exit 0, **4 pass / 0 fail / 32 assertions**.

The cases prove:

1. A real known project, scene, track, clip, media-metadata, and library edit followed by coordinator destruction, complete editor-session disposal, a newly constructed Host/session/coordinator, and reopen. Project/metadata/scene/track/clip/media/library private sentinels remain semantically equal, including `Date`, `Map`, `Set`, typed-array, and attachment-byte values.
2. Scene/track/clip deletion and replacement, media identity replacement/removal/recreation, and library item replacement. Deleted identities lose private data and new identities do not inherit it.
3. Two complete sessions over one store see committed durable changes while decoded objects, caches, and listeners remain independent.
4. Same-key durable writes serialize, distinct logical keys progress independently, and a typed store failure rejects before cache/listener success or persisted-value replacement.

The round-trip is not a load/save no-op: the test changes known values at every named projection before saving.

## Boundary and quality gates

| Command | Result |
| --- | --- |
| `bunx eslint apps/web/src/editor/persistence --ext .ts` | exit 0; only the repository's non-failing Next pages-directory notice |
| `bunx prettier --check apps/web/src/editor/persistence` | exit 0 |
| `node script/check-session-state-boundary.mjs` | exit 0; 9/9 factories, 9/9 registry keys, 53 classified imperative modules |
| `node script/check-storage-boundary.mjs` | exit 0; 743 files, browser mechanisms still confined to storage services |
| `node script/check-port-boundary.mjs` | exit 0; 30 contract modules, no editor-schema or storage-mechanism leak |
| `node script/check-type-baseline.mjs` | exit 0; exactly three current diagnostics, all inside the pinned inherited set; no C5 identity |
| `git diff --check` | exit 0 |
| `rasen validate s02-storage-port --strict --project rocut --json` | exit 0; valid, zero issues |

The whole-tree type-baseline gate was rerun after the concurrent section-5 narrowing fix and returned to exactly three diagnostics, all within the pinned inherited baseline. Section 7 contributes no diagnostic.

## Stop-condition disposition

No provider-private sentinel was lost. The 7.10 hard stop did not trigger.
