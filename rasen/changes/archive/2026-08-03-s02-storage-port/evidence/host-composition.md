# C5 Host composition and provisional-path retirement

Date: 2026-08-02

## Result

Tasks 9.1–9.10 are implemented in the shared C5 worktree. Both production
composition roots now construct a module-stable `BrowserProjectStore` with the
explicit production durable identity and assign it after the in-memory/runtime
spreads. Repeated Host construction therefore reuses one store object per Host
root. Two sessions over one store share committed records while their
`SessionPersistenceCoordinator` instances and decoded caches remain distinct.

`EditorHost` now requires `EditorHostPorts` directly. The protected public
session files keep their previous byte-exact imports and types: the Host module
retains `ResolvedEditorHost` as an alias of the already-required `EditorHost`
and `resolveEditorHost` as an identity function. There is no partial Host,
runtime narrowing, cast or in-memory fallback.

The Vite project picker obtains project summaries through the session-owned
coordinator and capacity through that coordinator's configured Host store. The
provisional `browser-host-adapter.ts` file is deleted. The process-global
`storageService` instance export is removed; only the legacy `StorageService`
class remains exportable for the isolated migration control.

## Mechanical composition gate

`script/check-host-composition.mjs` scans both Host roots plus the production
graph. Its positive run scanned two roots and 710 production modules and passed:

- stable, explicitly identified browser stores declared before each factory;
- final store overrides after all reference/browser spreads;
- required `EditorHost` plus identity-only protected compatibility resolver;
- no production in-memory store, store fallback, retired adapter,
  process-global storage import/export, parallel Host storage property or
  private store/coordinator React context.

The negative run passed 10/10 controls: unstable construction, missing final
override, fallback, production `InMemoryProjectStore`, adapter resurrection,
incomplete Host, partial/resolving Host, parallel Host property, private context
and process-global storage.

The session-state gate was also made deletion-safe and current with the tenth
session-owned store family. `customPresets` is registered through its real
`createCustomPresetsStore` factory, counts derive from the ownership inventory,
and the obsolete storage-provider imperative classification was removed after
that component moved to a reactive selector. Result: 10/10 factories, 10/10
registry keys and 52 classified imperative modules; the negative controls pass.

## Focused verification

| Command / gate                                                    | Result                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| isolated `production-composition.test.ts`                         | 5 pass, 0 fail, 25 expectations                                  |
| isolated `session-lifecycle.test.ts`                              | 40 pass, 0 fail, 102 expectations                                |
| Host + lifecycle/runtime/state/async + port conformance group     | 33 wrapper/direct tests pass, 0 fail, 179 expectations           |
| in-memory port conformance                                        | 18 storage cases pass, 0 fail, one intentional no-migration skip |
| `check-host-composition` positive / negative                      | PASS / PASS (10 negative controls)                               |
| `check-port-boundary`                                             | PASS, 30 contract modules                                        |
| `check-session-state-boundary` positive / negative                | PASS / PASS                                                      |
| `check-type-baseline`                                             | PASS, exactly three inherited diagnostics and no new identity    |
| `git diff --check`                                                | PASS                                                             |
| `rasen validate s02-storage-port --project rocut --strict --json` | PASS, zero issues                                                |

The session lifecycle expansion explicitly passes migration once-per-store,
same-store second session, concurrent same-store waiter, thrown migration memo
eviction, persisted-version failure retry and reported-failure retry cases.

Targeted ESLint reports only pre-existing errors in unchanged lines of the port
register, session lifecycle fixture, session factory and legacy storage class;
none appears in the new Host composition test/checker or changed Host/picker
logic. Vite example files are outside the root ESLint configuration. The pinned
type ceiling is the authoritative regression gate and is green.

## Protected surfaces

- `apps/web/src/editor/session/create-session.ts`:
  `ee63d7843fa73df6959aa92030bf4871236b6038` in HEAD and worktree.
- `apps/web/src/editor/session/session-types.ts`:
  `c67d9822a2a6c994be14f367e6980fbbaa6e454b` in HEAD and worktree.

## Section-10 dependency

The canonical `script/check-storage-boundary.mjs` still describes the retired
adapter and therefore intentionally fails with zero adapter users. That script
and its negative fixtures belong to task group 10 and were explicitly outside
this leaf's write scope. The product graph is already in the final state; group
10 must update the canonical policy before C5 final verification.
