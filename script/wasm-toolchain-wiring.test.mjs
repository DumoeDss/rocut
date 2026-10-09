import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasEnforcedBuildToolchain } from "./wasm-toolchain-wiring.mjs";

const source = readFileSync(
	new URL("./build-wasm.mjs", import.meta.url),
	"utf8",
);

test("recognizes the imported assertion as the invoked default before wasm-pack", () => {
	assert.equal(hasEnforcedBuildToolchain(source), true);
});

for (const [name, mutate] of [
	["missing call", (text) => text.replace("assertPins();", "")],
	[
		"comment-only call",
		(text) => text.replace("assertPins();", "// assertPins();"),
	],
	[
		"uncalled helper",
		(text) =>
			text.replace("assertPins();", "function decoy() { assertPins(); }"),
	],
	[
		"wrong default",
		(text) =>
			text.replace("assertPins = assertToolchain", "assertPins = () => {}"),
	],
	[
		"wrong imported assertion",
		(text) =>
			text.replace(
				"import { assertToolchain }",
				"import { inspectToolchain as assertToolchain }",
			),
	],
	[
		"wrong bypass condition",
		(text) =>
			text.replace(
				'OPENCUT_WASM_ALLOW_UNPINNED === "1"',
				'OPENCUT_WASM_ALLOW_UNPINNED !== "1"',
			),
	],
	[
		"only assertion after build",
		(text) =>
			text
				.replace("assertPins();", "")
				.replace("if (result.error)", "assertPins();\n\tif (result.error)"),
	],
]) {
	test(`rejects ${name}`, () => {
		const changed = mutate(source);
		assert.notEqual(changed, source);
		assert.equal(hasEnforcedBuildToolchain(changed), false);
	});
}
