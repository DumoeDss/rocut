# Canonical capability falsification sweep

- Verified: 2026-08-10
- Corpus: all rasen/specs/*/spec.md present in the worktree
- Corpus SHA-256 (sorted path + NUL + bytes + NUL): 659f7cc1d3ea79df2e8108e39fe206ead2ea600ae8d5ef15ecbb24c06ade7969
- Inventory: 16 files, 141 Requirement blocks, 353 uppercase SHALL/MUST occurrences

Method: every Requirement block was read as one assertion group, every uppercase normative occurrence was counted case-sensitively, and each group was reviewed for a behavior or scope contradiction introduced by T3. "Not falsified" is not a claim that every historical capability was reimplemented in this change; unchanged capabilities are protected by the T3 path audit plus their applicable retained gates.

Evidence bases:

- **B1:** persistence coordination/failure suites, exact-record adoption, both-host save/reopen parity, and no browser-store/migration edit.
- **B2:** both production builds and documented parity commands executed; developer docs untouched.
- **B3:** baseline and after-routing Vite/Next scenarios passed; four-axis comparison and editing-view hashes recorded in implementation-report.md.
- **B4:** session ownership/isolation tests included in the green suite; no session contract, provider root, or lifecycle surface edit.
- **B5:** no headless entry, collector, Host adapter, or headless contract edit.
- **B6:** transaction boundary and negative control passed; no Host-port contract or production composition-root edit.
- **B7:** no server-service configuration or Host-service seam edit.
- **B8:** no inherited-defect oracle/record edit; production minification and audio-reopen defects found by parity have dedicated regressions.
- **B9:** both production builds and both Host scenarios passed; no Host composition-root or Vite source edit.
- **B10:** both fresh production builds and Host scenarios passed; no runtime asset/manifest path edit.
- **B11:** no Rust, generated WASM, package-resolution, or correspondence artifact edit; both builds passed.
- **B12:** no resource registry/owner implementation edit; session tests remained green.
- **B13:** session ownership/isolation tests remained green; no Zustand registry, renderer, or compositor edit.
- **B14:** combined T3/T0/T1/T2 suites passed 76/76 with 793 assertions; transaction boundary, negative control, type baseline, persistence failure/reopen, settings, undo/redo, and parity evidence passed.
- **B15:** no license, provenance, defects record, patch log, or type-baseline fixture edit; type baseline stayed at 3.
- **B16:** no Rust/generated-WASM/provider-surface edit; both builds and editing parity remained green.

## browser-persistence-boundary

Source: rasen/specs/browser-persistence-boundary/spec.md; basis: **B1**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | A single named boundary owns browser persistence | 6 | 3 | 0 | not falsified |
| 2 | Save and reopen survive a full page reload | 48 | 3 | 0 | not falsified |
| 3 | Transient object URLs are never persisted as canonical locators | 77 | 1 | 0 | not falsified |
| 4 | The migration runner operates on the real projects database | 93 | 3 | 0 | not falsified |
| 5 | A project written by an older schema version is brought to the current version | 126 | 3 | 1 | not falsified |
| 6 | Legacy per-project databases are read before they are deleted | 171 | 1 | 0 | not falsified |
| 7 | Physical cleanup authority is topology-safe | 192 | 7 | 0 | not falsified |

## developer-reproducibility

Source: rasen/specs/developer-reproducibility/spec.md; basis: **B2**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | A documented path takes a clean checkout to a running production build | 6 | 2 | 0 | not falsified |
| 2 | The developer path does not require Elftia | 52 | 1 | 0 | not falsified |
| 3 | The parity scenario is runnable by a new developer | 61 | 1 | 0 | not falsified |
| 4 | Known deviations are inspectable | 72 | 1 | 0 | not falsified |
| 5 | The distributable export surface is inventoried | 83 | 1 | 0 | not falsified |

## editing-parity-fixture

Source: rasen/specs/editing-parity-fixture/spec.md; basis: **B3**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | A redistributable fixture media set exists | 6 | 1 | 0 | not falsified |
| 2 | The parity scenario exercises a representative multi-track edit | 20 | 1 | 0 | not falsified |
| 3 | The scenario is offline-deterministic | 44 | 1 | 0 | not falsified |
| 4 | A normalized canonical snapshot is captured and compared to the Classic baseline | 55 | 2 | 0 | not falsified |
| 5 | A defect repair is accompanied by a parity re-run that separates two kinds of movement | 99 | 2 | 0 | not falsified |

## editor-session-runtime

Source: rasen/specs/editor-session-runtime/spec.md; basis: **B4**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | An editor session is created from explicit dependencies | 8 | 2 | 0 | not falsified |
| 2 | The session lifecycle is part of the contract | 25 | 1 | 0 | not falsified |
| 3 | Mount returns a root handle that makes unmount triggerable | 42 | 3 | 0 | not falsified |
| 4 | Session-owned resources are acquired through the session, not registered afterwards | 76 | 2 | 0 | not falsified |
| 5 | Disposal is owned by the session and reports what it released | 101 | 4 | 0 | not falsified |
| 6 | Schema migration is owned by the store implementation and run once per session creation | 120 | 3 | 0 | not falsified |
| 7 | A runtime session owns one explicit editor core | 149 | 3 | 0 | not falsified |
| 8 | Command execution uses explicit session context | 173 | 3 | 0 | not falsified |
| 9 | React and Host consumers resolve the explicit session | 195 | 5 | 0 | not falsified |
| 10 | Process definitions register once while session wiring remains per-session | 227 | 2 | 0 | not falsified |
| 11 | Newly multiplied core side effects are cleaned up | 244 | 3 | 0 | not falsified |
| 12 | The process-global editor singleton cannot return | 261 | 2 | 0 | not falsified |
| 13 | C2 preserves behavior while C3 closes its deferred state and renderer boundaries | 285 | 2 | 0 | not falsified |

## headless-editing

Source: rasen/specs/headless-editing/spec.md; basis: **B5**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | A provider-private headless session exposes only data lifecycle operations | 9 | 1 | 0 | not falsified |
| 2 | Headless editing survives save, disposal, and reopen | 28 | 0 | 1 | not falsified |
| 3 | Full and headless sessions share one migration gate | 51 | 0 | 1 | not falsified |
| 4 | The headless path uses only the non-browser store | 74 | 1 | 1 | not falsified |
| 5 | Opaque provider data and attachments survive the round trip | 89 | 0 | 2 | not falsified |
| 6 | Headless ownership is serialized, terminal, and resource-free | 108 | 1 | 1 | not falsified |
| 7 | Vite emits and executes a dedicated headless artifact | 131 | 0 | 1 | not falsified |
| 8 | Next emits and executes a dedicated per-entry headless artifact | 150 | 1 | 1 | not falsified |
| 9 | The emitted closure contains the real headless implementation | 173 | 0 | 1 | not falsified |
| 10 | React-family dependencies are mechanically absent from the emitted closure | 192 | 1 | 1 | not falsified |
| 11 | Each Host proves React-detection sensitivity with the same path | 211 | 0 | 2 | not falsified |
| 12 | Runtime evidence is truthful and independently attributable | 230 | 0 | 1 | not falsified |
| 13 | C3 through C6 invariants and ordinary Host behavior remain protected | 249 | 0 | 1 | not falsified |
| 14 | Verification, delivery, integration, and archive remain distinct | 272 | 0 | 1 | not falsified |

## host-port-contract

Source: rasen/specs/host-port-contract/spec.md; basis: **B6**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | The Host contract is one coherent surface | 6 | 3 | 2 | not falsified |
| 2 | No port signature exposes an editor-internal or storage-mechanism type | 42 | 3 | 0 | not falsified |
| 3 | A worker is expressed so that a same-origin Host can implement it | 77 | 4 | 0 | not falsified |
| 4 | Graphics capability is negotiated, and the report is produced by the runtime | 108 | 4 | 0 | not falsified |
| 5 | Preview concurrency is a reported capability, expressed as a count | 146 | 5 | 0 | not falsified |
| 6 | Every port has an in-memory reference implementation and a conformance suite | 176 | 2 | 0 | not falsified |
| 7 | The port-shape decisions are recorded with their forcing evidence | 212 | 1 | 0 | not falsified |
| 8 | Storage operations have explicit failure and cancellation semantics | 232 | 3 | 1 | not falsified |
| 9 | Durable storage scopes are isolated while intentional sharing remains visible | 277 | 2 | 0 | not falsified |

## host-service-boundary

Source: rasen/specs/host-service-boundary/spec.md; basis: **B7**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | Server-backed editor features are configured by the host | 6 | 1 | 0 | not falsified |
| 2 | Unavailable server-backed features degrade visibly and non-blockingly | 22 | 2 | 0 | not falsified |
| 3 | Per-feature handling is recorded | 45 | 2 | 0 | not falsified |
| 4 | Remote network dependencies are diagnostics, not acceptance | 69 | 2 | 0 | not falsified |

## inherited-defect-repair

Source: rasen/specs/inherited-defect-repair/spec.md; basis: **B8**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | An inherited defect is enumerated from a mechanical oracle, not from prose | 6 | 2 | 0 | not falsified |
| 2 | Every enumerated site receives one of exactly two evidenced verdicts | 32 | 1 | 0 | not falsified |
| 3 | A hypothesis about the defects' distribution is tested before it is relied on | 58 | 1 | 0 | not falsified |
| 4 | A call passing positional arguments into an options-object function is a defect | 69 | 1 | 0 | not falsified |
| 5 | An imported symbol is defined somewhere in the repository | 94 | 1 | 0 | not falsified |

## next-free-distributable-boundary

Source: rasen/specs/next-free-distributable-boundary/spec.md; basis: **B9**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | The production editor bundle contains no Next.js runtime module | 6 | 1 | 0 | not falsified |
| 2 | Project identity and navigation enter through props and callbacks | 24 | 1 | 0 | not falsified |
| 3 | The editor mounts inside its root container | 46 | 2 | 0 | not falsified |
| 4 | Non-editor product code is absent from the distributable graph | 62 | 1 | 0 | not falsified |
| 5 | Declared-but-unused root manifest entries do not affect the boundary result | 80 | 1 | 0 | not falsified |
| 6 | The Next application still builds and behaves identically | 92 | 1 | 0 | not falsified |

## runtime-asset-delivery

Source: rasen/specs/runtime-asset-delivery/spec.md; basis: **B10**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | WASM and worker modules load from the production build | 6 | 2 | 1 | not falsified |
| 2 | Required data assets resolve from the production build | 37 | 3 | 0 | not falsified |
| 3 | A runtime asset manifest is published with the build | 72 | 3 | 0 | not falsified |
| 4 | Initialization and WASM failures produce visible diagnostics | 107 | 4 | 0 | not falsified |

## self-built-wasm-artifact

Source: rasen/specs/self-built-wasm-artifact/spec.md; basis: **B11**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | The wasm module the editor loads is built from this repository's sources | 6 | 2 | 0 | not falsified |
| 2 | The self-built artifact corresponds to the published package it replaces | 39 | 3 | 0 | not falsified |
| 3 | The switch changes no exported function and no editing behaviour | 78 | 2 | 0 | not falsified |
| 4 | The redistributed binary does not disclose the build machine | 98 | 2 | 0 | not falsified |
| 5 | The wasm crate ships the licence it declares | 134 | 1 | 0 | not falsified |

## session-resource-disposal

Source: rasen/specs/session-resource-disposal/spec.md; basis: **B12**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | Lifecycle transitions are serialized and disposal wins permanently | 9 | 2 | 0 | not falsified |
| 2 | Suspend is quiescent while retaining session identity | 30 | 3 | 0 | not falsified |
| 3 | Every live resource acquisition crosses the owning session seam | 51 | 2 | 0 | not falsified |
| 4 | Session timers are cancelled and cannot publish after quiescence | 72 | 3 | 0 | not falsified |
| 5 | Worker lifetime is session-owned and pending work settles | 89 | 2 | 0 | not falsified |
| 6 | Live audio contexts are owned, awaited, and generation-safe | 106 | 4 | 0 | not falsified |
| 7 | Object URLs have explicit session ownership | 127 | 3 | 0 | not falsified |
| 8 | Resource-holding caches and services have deterministic owners | 148 | 2 | 0 | not falsified |
| 9 | Disposal is an exhaustive asynchronous drain | 169 | 1 | 0 | not falsified |
| 10 | Shared GPU teardown is owned by the final runtime lease | 194 | 3 | 0 | not falsified |
| 11 | The multi-cycle leak oracle proves all five classes non-vacuously | 223 | 2 | 0 | not falsified |
| 12 | Vite and Next produce independent production-shaped disposal evidence | 248 | 2 | 0 | not falsified |
| 13 | C3, C4, and C5 invariants remain protected | 269 | 3 | 0 | not falsified |
| 14 | Verification preserves inherited oracles and scope boundaries | 290 | 3 | 0 | not falsified |

## session-state-isolation

Source: rasen/specs/session-state-isolation/spec.md; basis: **B13**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | Every editor session owns one complete nine-store registry | 10 | 3 | 0 | not falsified |
| 2 | Core and live editor state are independent across two sessions | 33 | 2 | 0 | not falsified |
| 3 | Shared durable preferences do not become shared live state | 56 | 3 | 0 | not falsified |
| 4 | Editor React reads declare reactive or imperative intent | 81 | 2 | 0 | not falsified |
| 5 | Mutable interaction state is session-owned and every retained singleton is classified | 111 | 2 | 0 | not falsified |
| 6 | A session owns one explicit runtime compositor handle | 137 | 3 | 0 | not falsified |
| 7 | Renderer readiness and asynchronous completion obey session generations | 167 | 2 | 0 | not falsified |
| 8 | MigrationDialog observes its owning project's live migration state | 190 | 2 | 0 | not falsified |
| 9 | Real-browser evidence enforces honest backend-specific preview capacity | 207 | 4 | 0 | not falsified |

## transaction-automation-api

Source: rasen/specs/transaction-automation-api/spec.md; basis: **B14**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | Host-neutral domain types are frozen | 6 | 4 | 0 | not falsified |
| 2 | The read interface queries project content | 31 | 3 | 0 | not falsified |
| 3 | The apply interface submits atomic batches | 51 | 5 | 0 | not falsified |
| 4 | Revisions are monotonic and conflicts are detected | 81 | 3 | 0 | not falsified |
| 5 | Idempotency keys deduplicate applies | 102 | 3 | 0 | not falsified |
| 6 | Structured errors report failure detail | 122 | 2 | 0 | not falsified |
| 7 | The getContext interface probes transaction metadata | 136 | 2 | 0 | not falsified |
| 8 | The watch interface subscribes to revision changes | 150 | 3 | 0 | not falsified |
| 9 | The contract contains no editor-internal types | 169 | 2 | 0 | not falsified |
| 10 | An in-memory fake implements every interface | 185 | 3 | 0 | not falsified |
| 11 | A conformance suite validates any implementation | 195 | 4 | 0 | not falsified |
| 12 | A durable transaction engine consumes the frozen Host port | 211 | 4 | 1 | not falsified |
| 13 | Apply commits one ordered durable batch | 231 | 4 | 1 | not falsified |
| 14 | Validation and dry-run are structured and non-mutating | 264 | 5 | 0 | not falsified |
| 15 | Placement policy enforces deterministic timeline validity | 291 | 5 | 1 | not falsified |
| 16 | Engine behavior is discoverable through typed features | 327 | 3 | 1 | not falsified |
| 17 | Reusable engine conformance proves T1 semantics | 348 | 4 | 1 | not falsified |
| 18 | Draft sessions capture isolated consistent base snapshots | 368 | 1 | 1 | not falsified |
| 19 | Each Draft tool call has an atomic savepoint | 408 | 1 | 2 | not falsified |
| 20 | Draft approval modes and reviews are explicit | 429 | 1 | 2 | not falsified |
| 21 | Approval is one conflict-checked transaction and one undo unit | 456 | 1 | 2 | not falsified |
| 22 | Draft-safe and immediate operations are formally separated | 538 | 2 | 2 | not falsified |
| 23 | Applied Draft resources survive source-package removal | 565 | 1 | 2 | not falsified |
| 24 | Reusable Draft conformance proves T2 semantics | 586 | 1 | 1 | not falsified |
| 25 | Project metadata updates are typed end-to-end transactions | 606 | 1 | 2 | not falsified |

## upstream-provenance

Source: rasen/specs/upstream-provenance/spec.md; basis: **B15**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | Pinned upstream identity is recorded | 6 | 1 | 0 | not falsified |
| 2 | Original license and copyright are preserved | 25 | 1 | 0 | not falsified |
| 3 | Every local behavioral modification is patch-logged | 34 | 1 | 0 | not falsified |
| 4 | Dependency and asset inventory distinguishes code from assets and codecs | 52 | 2 | 0 | not falsified |
| 5 | AGPL reference source is classified and mechanically excluded | 72 | 2 | 0 | not falsified |
| 6 | The wasm rebuild correspondence result is recorded | 92 | 9 | 0 | not falsified |
| 7 | The pinned type-diagnostic baseline records the pin, not the working tree | 143 | 2 | 0 | not falsified |
| 8 | Repairing a donor code defect does not repair a recorded metadata defect | 176 | 3 | 0 | not falsified |
| 9 | The known-defects record states the current disposition of each defect | 207 | 2 | 0 | not falsified |
| 10 | A derived inventory of modified files is regenerated after the commit that changes it | 225 | 2 | 0 | not falsified |

## wasm-api-surface

Source: rasen/specs/wasm-api-surface/spec.md; basis: **B16**.

| # | Requirement | line | SHALL | MUST | disposition |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | The compositor surface is handle-keyed and backward compatible | 9 | 4 | 0 | not falsified |
| 2 | Runtime graphics capability answers are truthful and typed | 33 | 3 | 0 | not falsified |
| 3 | Live GPU handles can be reconciled and released exactly | 59 | 3 | 0 | not falsified |
| 4 | Shared GPU teardown cannot invalidate a live compositor | 83 | 4 | 0 | not falsified |
| 5 | The generated surface is precise and mechanically guarded | 101 | 3 | 0 | not falsified |
| 6 | Existing editor parity is preserved after C3 explicit-handle wiring | 127 | 3 | 0 | not falsified |

## Totals

- Requirement blocks: 141
- SHALL occurrences: 314
- MUST occurrences: 39
- Total normative occurrences: 353
- Falsified by T3: 0
