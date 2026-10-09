import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	hash,
	inside,
	plain,
	writeJson,
} from "../particle-c4-export-support.mjs";

const [root, wasmDirectory] = process.argv.slice(2);
assert.ok(
	root && wasmDirectory && isAbsolute(root) && isAbsolute(wasmDirectory),
);
assert.ok(inside("C:/tmps/rocut-stylized-f6XU4z", root));
await plain(root, true);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(repo, "package.json"));
const ts = require("typescript");
const target = [
	"particle-editor-host.ts",
	"particle-editor-handoff-host.ts",
].map((name) => join(repo, "script/fixtures", name));
const baseline = join(repo, "script/fixtures/particle-c4-export-host.ts");
const common = {
	noEmit: true,
	allowJs: true,
	checkJs: false,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	skipLibCheck: true,
	esModuleInterop: true,
	strict: true,
};
const brief = (diagnostic) => ({
	file:
		diagnostic.file?.fileName
			.replaceAll("\\", "/")
			.replace(repo.replaceAll("\\", "/") + "/", "") ?? "(compiler options)",
	line:
		diagnostic.file && diagnostic.start !== undefined
			? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
			: null,
	code: diagnostic.code,
	message: ts
		.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
		.replaceAll(repo.replaceAll("\\", "/"), "[rocut]"),
});
const diagnose = (file, options) =>
	ts
		.getPreEmitDiagnostics(
			ts.createProgram(Array.isArray(file) ? file : [file], options),
		)
		.map(brief);
// Retain the initial, incorrectly scoped attempt and compare it with a
// pre-existing entrypoint before correcting declarations to the runtime used.
const unconfigured = { ...common, types: ["node", "bun"] };
const currentUnconfigured = diagnose(target, unconfigured);
const baselineUnconfigured = diagnose(baseline, unconfigured);
const baselineKeys = new Set(
	baselineUnconfigured.map((value) => JSON.stringify(value)),
);
const addedUnconfigured = currentUnconfigured.filter(
	(value) => !baselineKeys.has(JSON.stringify(value)),
);
const actual = {
	...common,
	jsx: ts.JsxEmit.ReactJSX,
	lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
	types: ["node"],
	paths: {
		"opencut-wasm": [join(wasmDirectory, "opencut_wasm.d.ts")],
		"opencut-wasm/sync": [join(wasmDirectory, "opencut_wasm.d.ts")],
	},
};
const productionRoots = [
	"packages/editor-classic/src/preview/hooks/use-transform-handles.ts",
	"packages/editor-classic/src/preview/controllers/transform-handle-controller.ts",
	"packages/editor-classic/src/types/eyedropper.d.ts",
	"packages/editor-classic/src/types/soundtouchjs.d.ts",
];
const diagnostics = diagnose(
	[...target, ...productionRoots.map((name) => join(repo, name))],
	actual,
);
const owned = [
	"script/probe-particle-editor.mjs",
	...[
		"build.mjs",
		"checks.mjs",
		"contract.mjs",
		"contract.test.mjs",
		"credentials.mjs",
		"credentials.test.mjs",
		"references.mjs",
		"handoff.mjs",
		"handoff-host.ts",
		"frozen-preload.mjs",
		"host.ts",
		"smoke.mjs",
		"validate.mjs",
	].map((name) => `script/fixtures/particle-editor-${name}`),
	...productionRoots,
	"packages/editor-classic/src/preview/hooks/__tests__/use-transform-handles.test.tsx",
];
const files = [];
for (const name of owned) {
	const bytes = await readFile(join(repo, name));
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	assert.ok(!text.includes("\uFFFD"), "Replacement characters rejected");
	assert.ok(
		!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191),
		"Unexpected BOM rejected",
	);
	files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
}
const evidence = {
	status: diagnostics.length || addedUnconfigured.length ? "failed" : "passed",
	typescriptVersion: ts.version,
	actualConfiguration: { ...actual, paths: actual.paths },
	diagnostics,
	initialUnconfiguredAttempt: {
		note: "Wrong default installed WASM declarations and unnecessary Bun ambient type lookup; not reported as a full-project typecheck failure",
		current: currentUnconfigured,
		existingC4HostBaseline: baselineUnconfigured,
		addedComparedToExistingEntrypoint: addedUnconfigured,
	},
	strictUtf8: true,
	unexpectedBom: false,
	replacementCharacters: false,
	files,
	baselineEntrypointSha256: hash(await readFile(baseline)),
	frozenDeclarationsSha256: hash(
		await readFile(join(wasmDirectory, "opencut_wasm.d.ts")),
	),
	scope:
		"Strict TypeScript diagnostics for the new Host and all reachable TypeScript dependencies using the exact frozen runtime declarations. JavaScript is syntax/CPU/bundle checked separately, not checkJs typechecked.",
};
await writeJson(join(root, "particle-editor-static-validation.json"), evidence);
assert.deepEqual(
	diagnostics,
	[],
	"Actual frozen-runtime typecheck must have no reachable diagnostics",
);
assert.deepEqual(
	addedUnconfigured,
	[],
	"No new diagnostics may be hidden by the baseline comparison",
);
console.log(
	JSON.stringify({
		status: evidence.status,
		reachableTypeDiagnostics: diagnostics.length,
		initialUnconfiguredDiagnostics: currentUnconfigured.length,
		addedUnconfiguredDiagnostics: addedUnconfigured.length,
		files: files.length,
	}),
);
