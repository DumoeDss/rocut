# @opencut/editor-automation

The agent-facing automation integration layer (design §26.7 / D24): one
composition of the frozen transaction engine and the Draft orchestrator,
behind the four frozen transaction interfaces plus `drafts`.

```ts
import { createAutomation } from "@opencut/editor-automation";

const automation = await createAutomation({
	store, // host-injected persistence — the one thing this layer never owns
	projectId,
	ids, // optional determinism seam for generated draft ids
	clock, // optional host clock for the Draft TTL mechanism
	draft: { ttl: 60_000, journalCallBound: 64 }, // host policy
});

await automation.apply({ operations: [...] }); // the engine's semantics, unchanged
const opened = await automation.openDraft({ approvalMode: "manual" });
```

Pure core + injected ports: persistence, clock and id generation arrive as
dependencies. Wraps — never forks — `@opencut/editor-contracts`, so the
`vectors/drivers/` conformance drivers keep every caller honest. Experimental
0.x surface until S06 reconciles.
