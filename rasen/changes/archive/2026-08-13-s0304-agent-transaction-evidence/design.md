## Context

The transaction line is complete except for its outward-facing evidence. T0 froze `read`/`apply`/`getContext`/`watch`, the twelve-member operation union, the five-code `TransactionError`, an in-memory fake and `runTransactionConformance`. T1 added `openTransactionEngine` over S02's `ProjectStore`, `validate`/`dryRun`, the placement policy, typed feature discovery and `runTransactionEngineConformance`. T2 added Drafts and their reusable conformance. T3 made `EditorCore.transactions` — `SessionOpenCutTransactions` — the one canonical per-project authority, serving UI commits and automation applies through the same ordered facade (`apply`, `validate`, `dryRun`, `tracks`, `clips`, `assets`, `markers`, `project`, `revision`, `capabilities`, `supportedOperations`, `watch`).

Three gaps remain, and all three are T4's.

**Nothing is published.** All three conformance suites are TypeScript modules in `apps/web/src/editor/contracts/**`. A third-party adapter author cannot run them without this tree, this toolchain and this repository's module resolution. Target State §5.1 asks for "versioned wire-safe schemas and conformance vectors"; "wire-safe" is the operative word, and no serialized corpus exists.

**No automation client has driven the real thing.** T3's evidence instruments the router from Bun tests. Slice §3.5 asks for an Agent script that creates tracks/assets/clips, moves/trims/splits, verifies revision changes per step, then saves, reopens and confirms — on the real Host, in a production build, across a genuine reload.

**One frozen scenario already binds T4.** The canonical spec's *Project metadata updates are typed end-to-end transactions* requirement contains "Agent evidence exercises the twelfth operation without inference": the vectors must advertise all twelve kinds, and the Agent must perform at least one typed Project patch, observe one revision/save/watch result, verify save/reopen Project equality, prove same-key replay is mutation-free and same-key/different-patch reuse is rejected, with no donor inference and no provider-private command. T4 satisfies that requirement; it does not restate it.

Two repository facts constrain where the Agent may live. `headless-editing` requires that the headless surface contain "no public transaction, revision, command-idempotency, draft, conflict, autosave, or generic mutable-store API" — so the Agent must not be built by widening the headless entry. And the shared evidence harness (`apps/web/src/editor/surface/evidence/surface-evidence-harness.tsx`, mounted by `apps/web/src/app/surface-evidence/page.tsx` and `apps/vite-example/src/surface-evidence-main.tsx`, both passing a real `createHost`) already gives both production Hosts one shared, React-mounted, ledger-emitting evidence surface over a real `ProjectStore`.

## Goals / Non-Goals

**Goals:**

- Publish a versioned, wire-safe, self-describing vector corpus that a third party can execute against any implementation of the frozen interfaces.
- Derive the corpus's coverage claim from the contract's exported constants so the corpus cannot silently fall behind the surface it claims to cover.
- Provide one runner whose pass is impossible to obtain vacuously, and prove that with a mutation matrix and a converse control.
- Keep provider identity out of published vector data by machine check, not by review.
- Drive one Host-neutral Agent scenario definition from three drivers — the in-memory fake, the durable engine, and the real session engine on both production Hosts.
- Prove committed durability across a full reload and a fresh session, with negative controls that fail their named step.

**Non-Goals:**

- Re-prove T1 engine semantics (atomicity, ordering, save-failure atomicity, dry-run/validate purity, placement policy, feature discovery). The vectors *exercise* them; the requirements that own them are T1's.
- Re-prove T2 Draft semantics. T4's scenario is a direct-apply automation client and opens no Draft; T2's reusable Draft conformance owns that ground.
- Re-prove T3 UI commit routing, interleaved UI/automation ordering, pointer-preview commit counts, routed undo/redo, or duplicate-save suppression.
- Change any contract type, engine behaviour, Draft surface, donor router, command, persistence path, Host composition root, Surface component, Host port, Rust/WASM artifact or package boundary.
- Publish an npm package, define a package export map, or add a second Host (S05).
- Claim attachment bytes or media payloads commit atomically with the project record.
- Claim whole-document equality between Hosts; the parity oracle owns editing-behaviour equality and is untouched.

## Decisions

### D1: Vectors are wire-safe JSON data, not more TypeScript conformance cases

The corpus is committed JSON under `apps/web/src/editor/contracts/vectors/corpus/`, versioned by an explicit schema id (`transaction-vectors/v1`) carried inside every file. Values are wire-safe: `MediaTime` appears as an integer tick count, ids as strings, operation kinds and error codes as members of the contract's closed unions. Nothing at rest depends on a branded type, a TypeScript declaration or a module import.

This is the only reading of Target State §5.1 that does work the existing suites do not already do. `runTransactionConformance` is a code artifact; a corpus is a data artifact, and a data artifact is what a non-TypeScript implementation, a different runtime, or a future package consumer can actually take.

**Alternatives considered:**

1. Add more cases to `runTransactionConformance`. Rejected — it duplicates T0's requirement and publishes nothing; a consumer still needs this repository.
2. Generate vectors at run time from the fake. Rejected — a corpus derived from the reference implementation cannot detect that the reference implementation drifted; the committed corpus must be reviewable, diffable evidence in its own right.
3. Express vectors as `.ts` literal fixtures. Rejected — convenient in-tree, useless on the wire, and it re-imports the branded constructors the corpus exists to avoid depending on.

### D2: The corpus has two families — seeded document vectors and relative scenario vectors

A **document vector** carries an explicit initial document, one batch (with optional `expectedRevision` and `idempotencyKey`) and its expected `TransactionResult` or structured rejection. It requires a target that can be opened over a supplied document — the in-memory fake and a freshly opened durable engine can; the real Host session engine cannot, because its document is whatever the loaded project holds.

A **scenario vector** carries an ordered step plan and asserts only *relative* outcomes: revision delta per step, created/changed identities the step itself introduced, the code of an expected rejection, and per-step watcher/save deltas where the driver can observe them. It therefore runs against any target, including a real Host project that already contains a donor default scene (`ProjectManager.createNewProject` builds one, so "empty project" is not available and must not be assumed).

Relative assertions are weaker than document equality, which is exactly why D3's coverage derivation and D4's mutation matrix are mandatory rather than optional: the relative form must be shown able to fail.

**Alternatives considered:**

1. One family with a required seed. Rejected — it would exclude the real Host, which is the only target that proves the Agent claim.
2. One family with no seed. Rejected — conflict, idempotency and placement cases need a known starting document to be precise about the expected error.
3. Let a target skip the vectors it cannot seed. Rejected — that is the silent-partial-pass hazard; D4 makes unsupported a whole-family verdict instead.

### D3: Coverage is derived from the contract's exported constants, and drift fails

The coverage report is computed by intersecting the parsed corpus with `OPERATION_KINDS`, the `TransactionErrorCode` members and `TransactionEngineIssueCode` members **as the contract exports them**, not against a list restated in the vectors package. A kind or code the contract exports with no vector covering it fails the corpus gate.

This is the shape of anti-drift check this portfolio has already been burned by: a test that reads only the expression under test proves nothing. The control that makes it real is the converse one — a fixture run in which the exported constant list is extended by one synthetic member must make the coverage gate **fail**, proving the gate reads the contract rather than the corpus's own self-description.

- **Negative control:** delete one vector covering `delete-marker` (fixture corpus) → coverage gate fails naming that kind.
- **Converse control:** a corpus that covers every exported kind and code passes, and adding an *unused* extra vector does not fail it — the gate checks coverage, not an exact-equality of counts a future contributor would have to hand-maintain.

The manifest additionally records each corpus file's SHA-256 and a corpus digest; a file edited without regenerating the manifest fails to load. That protects the published artifact from silent divergence between what is claimed and what is shipped.

### D4: One published runner, and a pass it cannot obtain vacuously

`runTransactionVectors({ corpus, open })` is a plain async function: no React, no Electron, no Host port, no test framework, no file-system access (the caller supplies the parsed corpus). It returns per-vector `passed | failed | skipped | unsupported` plus the D3 coverage report and an executed-comparison count per vector.

Fail-closed rules, each with a control:

| Rule | Negative control | Converse control |
| --- | --- | --- |
| An empty or fully filtered corpus is a failure | run with a filter matching nothing → non-zero, reported as `refused-empty-scan` | a filter matching one vector runs exactly that vector and passes |
| Executed count must equal declared count | drop a vector between manifest and run → fails as drift | manifest and corpus in agreement pass |
| A vector that made no comparison is a failure | a fixture vector whose expectation set is empty → load error, not skip | a vector with one comparison passes |
| A target that cannot seed a family reports the family `unsupported` | a non-seedable target → family `unsupported`, run verdict not `passed` | a seedable target reports no `unsupported` family |

Sensitivity and specificity are proven by a **mutation matrix**: wrapper targets that return a stale revision, apply a batch non-atomically, ignore `idempotencyKey`, notify watchers on a rejected apply, return internal state without cloning, or waive a base placement rule. Each wrapper must fail an exactly declared set of vector ids — asserting the set, not merely "at least one failure", so a wrapper that fails everything for the wrong reason is caught too. The converse is a **conforming variant**: an implementation that returns `changedIds` in a different order, adds optional fields, and uses different internal storage must pass every vector. That control is what stops the corpus from over-constraining implementations into copying the reference.

### D5: Published vector data is inside the contract boundary, and the boundary check learns to read it

The corpus lives under `apps/web/src/editor/contracts/vectors/`, so it travels with the contract when S05 extracts the package, and so `script/check-transaction-boundary.mjs` is the natural enforcement point. That checker currently enumerates tracked and uncommitted files under `apps/web/src/editor/contracts/` and filters to `.ts`/`.tsx`; T4 extends the enumeration to the corpus's `.json` files and adds rules for data, since the existing import-shaped rules cannot see a donor name that appears as a JSON string value.

New rules: no donor schema field name, command-class name, Zustand store name, IndexedDB or OPFS identifier, `opencut`-namespaced key, or physical storage path anywhere in a published vector — in keys or in values.

- **Negative control:** one fixture per new rule, each violating exactly one rule (a vector with a `timelineElement` key; one with an object-store name; one with an `opencut`-prefixed private key; one with an OPFS path value), each asserted caught by its own rule.
- **Converse control:** legitimate vectors that contain the words `track`, `clip`, `asset`, `marker`, `project` and a `video`-kind asset must **not** be caught — the rules must discriminate the public vocabulary from donor identity, or they are unusable.
- **Vacuity:** the extended scan refuses to report a pass when it matched zero corpus files, mirroring the existing zero-module refusal.

**Alternative considered:** put the corpus at the repository root outside `contracts/**`. Rejected — it would fall outside the boundary check, and it would not travel with the package S05 extracts.

### D6: The Agent runs as an automation client of the session engine facade, through the existing shared evidence entry

One Host-neutral scenario definition, executed by three drivers:

1. **Node / in-memory fake** — proves the scenario is React-free and Electron-free, which is the M3 bullet the fake exists to serve.
2. **Node / durable engine** over S02's in-memory `ProjectStore` with T1's native adapter — proves the scenario against durable revision, idempotency and reopen semantics without a browser.
3. **Browser / real session engine** on both production Hosts — `editorForSession(session).transactions`, the exact facade T3 routes UI commits through, over each Host's real project store.

Driver 3 mounts through the existing `surface-evidence` entry, selected by a scenario parameter read inside the shared harness component. Both Host entries already pass a real `createHost` and nothing else the agent scenario needs, so **no Host file changes**: not `apps/web/src/app/surface-evidence/page.tsx`, not `apps/vite-example/src/surface-evidence-main.tsx`, not the Vite entry list, not either composition root. The default (no parameter) path stays behaviourally identical, protecting R2's frozen Surface evidence.

The Agent uses only the public typed surface. It must not import a donor module, call `editor.persistence.saveProject`, construct a command class, or reach into the router's private state; the scenario module is placed so the transaction boundary check covers what it can, and a scope audit covers the rest.

**Alternatives considered:**

1. Drive the Agent through the headless entry. **Rejected on a live spec assertion** — `headless-editing` requires the headless surface to expose no public transaction or revision API; using it would either falsify that requirement or force a widening T4 has no mandate for.
2. Add a new `agent-evidence.html` Vite entry plus a new Next route. Rejected — it is exactly the Host-specific machinery the portfolio avoids, it changes the Vite input list and the emitted module graph, and it duplicates a harness that already mounts on both Hosts.
3. Node-only evidence. Rejected — Slice §3.5 and Plan §6 ask for save, full reload and reopen on the real Hosts; an in-memory store cannot produce that.
4. Browser-only evidence. Rejected — it would leave the "runs without React or Electron" bullet unproven.

### D7: Durability is proven by reload plus a fresh session, bound to the exact committed revision

After the apply phase the driver records the committed revision and the identities the scenario created, then performs a **full page reload**, mounts a fresh session over the same durable store, and asserts that the reopened engine reports that exact revision and that every entity the scenario created is present with the field values it committed — including the `update-project` patch, which the canonical T4 scenario names explicitly.

Controls:

- **Negative (stale reopen):** a control run in which the driver asserts against a revision one lower than committed must fail the reopen step. This proves the reopen assertion is bound to the observed value rather than to whatever the store returns.
- **Negative (injected durable failure):** a declared step whose save is made to reject must leave revision, reads and watcher count unchanged, and the run must report that step failed rather than skipping it.
- **Converse (slow store):** the same scenario against a deliberately delayed save must still pass, proving the assertions are about outcomes and not about timing — and that the driver waits on observable state rather than on sleeps.

### D8: Evidence accounting is part of the artifact, not a report written afterwards

Every driver emits the same machine-readable ledger: schema id, host/driver identity, declared step plan, and per step — id, base revision, result revision, revision delta, apply count, durable-save count, watcher count, assertion count, verdict. The run fails when any step asserted nothing, when executed steps differ from the declared plan, when a driver produced no ledger, or when either Host did not execute. A screenshot-only or console-only step is not evidence and is rejected by the same rule.

This is the direct answer to the four vacuity failures this portfolio has already caught: an artifact with no content, a probe reporting an always-empty array, a hard-coded zero, and an anti-drift test that read only itself. Each of those would be caught here by, respectively, the empty-scan refusal, the assertion-count rule, the mutation matrix, and D3's converse control.

### D9: Verification runs the inherited gates unchanged

Both Host production builds; the established normalized editing parity scenario on both Hosts with the snapshot unchanged (T4 changes no editing behaviour, so any movement is a defect, not an update); `check-transaction-boundary.mjs` normally and with `--negative-control`; the new corpus rules and their controls; `check-type-baseline.mjs` at or below the pinned ceiling of 3; `check-distributable-boundary.mjs` with its ten rules intact; the React-singleton, Surface CSS/portal and private-drag checks R2 pinned; the regenerated `SOURCE_INVENTORY.{md,json}`; a falsification sweep over every canonical `rasen/specs/*/spec.md` present at verification time, with `headless-editing`, `developer-reproducibility`, `next-free-distributable-boundary` and `editing-parity-fixture` reconciled explicitly; and hashes over the product/check/corpus set captured before and after the browser runs.

## Risks / Trade-offs

- **[Vectors over-constrain implementations]** A corpus written against the reference implementation can encode incidental detail as a requirement. → Compare identity sets rather than arrays, ignore unspecified optional fields, and gate on D4's conforming-variant converse control, which must pass every vector while differing in shape.
- **[Corpus rots against the contract]** A thirteenth operation kind or a sixth error code would leave the corpus quietly incomplete. → D3 derives coverage from the exported constants and fails on shortfall; its converse control proves the gate reads the contract.
- **[Relative scenario assertions are weak]** Revision deltas alone can be satisfied by a wrong implementation. → Every scenario step also asserts the identities and field values it created or changed, and the mutation matrix must show each step able to fail.
- **[Browser evidence is flaky across a reload]** IndexedDB and mount timing make reload assertions brittle. → Wait on the ledger's observable state, never on fixed sleeps; the slow-store converse control exists to keep that honest.
- **[Asset metadata is not media bytes]** The Agent creates asset catalog entries through typed operations while attachment bytes are an immediate effect. → State the limit in the evidence and assert only project-record content; make no atomicity claim about bytes.
- **[Corpus size in the distributable]** JSON imported by a contract module would enter the editor bundle. → No editor module imports the corpus; drivers read it from disk in Node and receive it as injected data in the browser, so the distributable graph gains only the runner if a Host chooses to use it.
- **[Touching the shared evidence harness could disturb R2]** R2's dual-Host Surface evidence is frozen and re-run by later gates. → The agent path is selected by an explicit parameter; the default path is unchanged, and R2's Surface matrix is re-run as a control rather than assumed intact.
- **[Boundary rules over JSON could be noisy]** Data rules matching substrings can catch legitimate public vocabulary. → The converse fixtures are part of the check, not part of the review, and a rule that fires on public vocabulary fails the control.

## Migration Plan

1. Author the corpus schema, loader, manifest generator and digest gate; commit the first corpus covering the frozen twelve kinds and closed code sets; prove load-time rejection of malformed and expectation-less vectors.
2. Implement coverage derivation against the exported constants and its negative/converse controls.
3. Implement `runTransactionVectors` with the fail-closed rules, then the mutation matrix and the conforming-variant converse control; run green against the in-memory fake and the durable engine.
4. Extend the transaction boundary check to the corpus data, with per-rule negative fixtures and public-vocabulary converse fixtures.
5. Author the Host-neutral Agent scenario definition and the two Node drivers; assert the ledger accounting rules on both.
6. Add the scenario parameter and agent ledger inside the shared evidence harness, and one Playwright spec beside the existing parity/surface specs that runs both Hosts, performs the reload, and writes per-Host results.
7. Run the durability negative and converse controls; capture per-Host ledgers, results and digests.
8. Run the inherited gates from D9, the falsification sweep, the scope audit and strict Rasen validation.

Rollback deletes the corpus, runner, scenario, drivers, harness parameter and the added boundary rules. No persisted record, contract type or runtime behaviour changes, so rollback leaves nothing behind to migrate.

## LEAD rulings on the open questions

Both are ruled; neither returns to Direction. Recorded before apply begins.

**OQ1 — Drafts stay out of T4's Agent scenario. RULED: exclude.** The T4 brief
(`planning-context.md:87`) reads "Agent script (create tracks/assets/clips, move/trim/split,
verify revisions) + published conformance vectors" and names no Draft step. Draft semantics
belong to T2 (`s0304-draft-editing-sessions`, archived), and restating them here would be a
duplicated claim rather than new evidence — precisely the failure mode this portfolio has
been penalising. If the dogfood work later wants a Draft-walking Agent run, that is a
deliberate scope addition owned by that slice, not an omission in T4.

**OQ2 — no build-artifact emission or export path in T4. RULED: exclude.** "Published"
means committed, versioned, digest-manifested and consumable from a checkout. Defining an
export path or emitting the corpus into `dist/` is package-boundary work, and expanding a
final child's scope into packaging late in a portfolio is the wrong trade. Recorded as
downstream work rather than silently dropped.

*Verification limit on OQ2:* the planner cited "Slice §5" for the package-boundary
exclusion. That document is not reachable from the rocut worktree, so the citation is
**unverified** — the ruling rests on the scope argument above, not on the citation.

## Open Questions

1. **Should the Draft lifecycle appear in T4's Agent scenario?** The parent's T4 brief and Plan §4 list only create/move/trim/split, revision verification and save/reopen; Plan §6's dogfood paragraph additionally walks a Draft open/rollback/approve inside the same session. This design excludes Drafts, because T2's reusable Draft conformance already owns those semantics and restating them would be duplicated claim rather than new evidence — and because the T2 dependency is independently justified: T2 was the last child to change the public surface the corpus must advertise, so vectors authored earlier would publish an incomplete contract. If the reviewer wants Plan §6's Draft segment attributed to T4, it is a deliberate scope addition, not an omission to be corrected silently.
2. **Should the corpus be emitted as a build artifact before S05?** Publishing today means "committed, versioned, digest-manifested and consumable from a checkout". Emitting it into `dist/` or defining an export path is package-boundary work that Slice §5 excludes and S05 owns. Recorded rather than assumed.
