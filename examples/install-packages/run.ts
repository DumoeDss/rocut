// The P6 placeholder run (task 2.3): the earliest end-to-end proof that the
// published-examples pipeline holds — the three @opencut/* packages install
// from the packed tarballs and their React-free entries resolve under bun.
// Task 3.1 replaces this with the full verification script (resolved versions,
// installed surface.json + policy README as data, classic metadata asserted
// without importing its runtime).
import { readFileSync } from "node:fs";

import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import { createInMemoryTransactionStore } from "@opencut/editor-contracts";

const fixture = createInMemoryProjectStoreFixture();
const store = createInMemoryTransactionStore();

const resolved = ["ports", "contracts", "classic"].map((short) => {
	const manifest = JSON.parse(
		readFileSync(`node_modules/@opencut/editor-${short}/package.json`, "utf8"),
	);
	return `${manifest.name}@${manifest.version}`;
});
console.log(`placeholder: resolved ${resolved.join(", ")}`);
console.log(
	`placeholder: React-free entries resolved (fixture store ready=${typeof fixture.store === "object"}, transaction store ready=${typeof store === "object"})`,
);
console.log("placeholder: install-packages pipeline green (the full example lands with task 3.1)");
