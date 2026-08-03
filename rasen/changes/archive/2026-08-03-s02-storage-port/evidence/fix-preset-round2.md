# C5 review round 2 — custom-preset publication fix

Date: 2026-08-02  
Scope: M5 and new test gap 7 only  
Status: implemented and verified; uncommitted

## Finding closed

`createCustomPresetsStore.load()` previously published every completed read. A load could capture
the old preset array, a later `savePreset` or `removePreset` could commit and publish the new
array, and then the old load could resolve last and overwrite that newer live StoreApi state.
Durability remained correct, but the active session hid a successful user action until reload.

## Deterministic RED

Two direct StoreApi tests use a persistence double whose first load returns a manually controlled
snapshot while mutations continue against a separate durable array:

1. load starts with an empty snapshot, save commits one preset, then the old empty load resolves;
2. load starts with two presets, remove commits one deletion, then the old two-preset load resolves.

Before the fix:

- command: `$env:OPENCUT_SESSION_ASYNC_STORE_TEST_ISOLATED='1'; bun test apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts`
- result: **12 passed, 2 failed, 75 assertions**
- save path received `[]` after the old load completed instead of the committed preset
- remove path restored `remove-me` after its successful durable deletion

Both cases also perform a later explicit reload and compare live state with the durable array.

## Implementation

The preset store now owns an instance-local `loadGeneration` counter:

- every load captures a new generation;
- load success, load-error publication, and loading-finalization publish only while that
  generation is still current and the store is not disposed;
- calling save or remove invalidates the current load immediately, before the mutation is queued,
  and clears the obsolete loading indicator;
- mutation success/failure remains on the existing serialized tail and the round-1 shared
  `SessionPersistenceCoordinator` library arbitration remains unchanged;
- stale loads still settle for their callers, but cannot replace presets, errors, or loading state.

The counter is closure state owned by one `createCustomPresetsStore` instance. No process-global
registry, durable payload owner, Host/session surface, storage mechanism, or new ownership
classification was introduced.

## GREEN and regression evidence

| Gate | Result |
| --- | --- |
| isolated session async-store suite | **14 passed, 0 failed, 78 assertions** |
| normal session async-store wrapper | **1 passed, 0 failed** |
| opaque round-trip wrapper | **1 passed, 0 failed** |
| focused ESLint | **PASS**; only the repository informational missing-pages message |
| focused Prettier | **PASS** |
| `node script/check-type-baseline.mjs` | **PASS**, exactly 3 current inherited diagnostics |
| `node script/check-session-state-boundary.mjs` | **PASS**, 10/10 factories, 10/10 registry keys, 52 classified imperative modules |
| `node script/check-storage-boundary.mjs` | **PASS**, 718 source modules |
| `node script/check-host-composition.mjs` | **PASS**, 2 Host roots / 715 production modules |
| `node script/check-port-boundary.mjs` | **PASS**, 30 contract modules |
| `git -c core.whitespace=cr-at-eol diff --check` | **PASS**; line-ending conversion warnings only |
| `rasen validate s02-storage-port --project rocut --strict --json` | **valid: true**, 1/1 after evidence write |

The existing test “a failed shared library mutation does not poison either session's next
update” remains green for custom presets, so the publication barrier does not alter the round-1
failure recovery or cross-session durable ordering.

## Exact round-2 fixer write set

- `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts`
- `apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts`

No coordinator, ProjectStore/Browser mechanics, Host, protected/public session surface, task
list, review report, or existing evidence was edited.
