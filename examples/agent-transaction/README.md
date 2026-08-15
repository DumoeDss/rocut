# agent-transaction

The agent-shaped consumer of the transaction contract: the published
`AGENT_SCENARIO` drives the published transaction engine over **this example's
own in-memory store** (`src/own-store.ts`) through the frozen S03 transaction
API. Every declared step is executed and asserted by the published runner, the
resulting ledger is written to `ledger.json`, and reload-reopen durability is
proven against a **fresh store instance over the same persisted data** — the
first store's contents are serialized to the example's own snapshot form, a new
store is constructed from it, and the published reopen verifier compares the
reopened engine's state field-for-field against what the run committed.

No browser, no React, no `@opencut/editor-classic` — this example runs on the
two frozen layers alone.

## Run it

Through the repo's runner (see `script/run-published-examples.mjs`):

```sh
OPENCUT_EXAMPLES=agent-transaction node script/run-published-examples.mjs
```

Standalone, once the packages are on a registry:

```sh
npm install
npx tsc --noEmit
bun run.ts
```

## What the run proves

- the declared scenario plan executes exactly — no step skipped, none extra
  (`executedSteps` equals the declared ids, `failureCodes` is empty);
- every accepted step costs exactly one durable save through the store, every
  rejected step none — the ledger's `durableSaves` is measured, not declared;
- a genuinely fresh store constructed from the persisted snapshot reopens at
  the committed revision with every created entity intact, field for field.

## Consumed surface

| Specifier | Class | Why |
| --- | --- | --- |
| `@opencut/editor-ports` (`.`) | frozen | `ProjectStore`/`ProjectRecord`/`ProjectSummary` types the own store implements, `ProjectId` |
| `@opencut/editor-contracts/engine` | frozen | `openTransactionEngine` + the native document adapter/seed — the S03 engine over the own store |
| `@opencut/editor-contracts/vectors` | frozen | `AGENT_SCENARIO`, `runAgentScenario`, `verifyAgentReopen` — the published scenario, runner and reopen verifier |

Nothing reads `surface.json` at runtime; the table above is documentation
mirroring the shipped labels (the P5 rule).
