/** Executable proof that opaque author data crosses the alien store unchanged. */
import { projectId } from "@opencut/editor-contracts";

import { AlienProjectStore } from "./src/alien-store";

const store = new AlienProjectStore();
const id = projectId("adapter-template-seed-check");
const opaque = {
	providerPrivate: {
		unicode: "adapter-opaque-世界",
		nested: [{ value: 1 }, { value: 2 }],
	},
};
await store.save({
	record: { id, schemaVersion: 1, data: opaque },
	summary: {
		id,
		name: "Adapter template seed check",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
});
const first = await store.load({ id });
if (JSON.stringify(first?.data) !== JSON.stringify(opaque)) {
	throw new Error("opaque data changed during the first alien-store round trip");
}
if (first?.data !== null && typeof first?.data === "object") {
	Reflect.set(first.data, "mutatedByConsumer", true);
}
const second = await store.load({ id });
if (JSON.stringify(second?.data) !== JSON.stringify(opaque)) {
	throw new Error("a consumer mutation leaked back into the alien store");
}

console.log(
	"seed-check/opaque-round-trip: PASS (nested opaque data exact; reads detached)",
);
console.log("REAL_EXIT_CODE[template-seed-check]:0");
