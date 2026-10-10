import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadGlassObjectWasm } from "./glass-object-preflight.mjs";

test("missing real WASM export cannot fall back to a numeric fake or old module", async () => {
	const root = await mkdtemp("C:/tmps/glass-object-missing-export-cpu-");
	await writeFile(
		join(root, "opencut_wasm_sync.js"),
		"export const unrelated = true;",
		{ flag: "wx" },
	);
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ type: "module" }),
		{ flag: "wx" },
	);
	await assert.rejects(loadGlassObjectWasm(root), /missing Glass resolver/);
});
test("WASM loader requires an explicit absolute package path", async () => {
	await assert.rejects(loadGlassObjectWasm("rust/wasm/pkg"));
});
