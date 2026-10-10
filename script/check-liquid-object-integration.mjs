import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [directory, expected] = process.argv.slice(2);
assert(
	directory && isAbsolute(directory) && /^[a-f0-9]{64}$/.test(expected ?? ""),
);
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp("C:/tmps/liquid-integration-quality-");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tests = [
	"packages/editor-contracts/src/__tests__/programmatic-build-capabilities.test.ts",
	"apps/cli/src/__tests__/three-liquid-object-capability.test.ts",
	"apps/cli/src/__tests__/three-liquid-object-provenance.test.ts",
	"apps/cli/src/__tests__/three-liquid-object-compiler.test.ts",
	"apps/cli/src/__tests__/three-liquid-object-shared-compiler.test.ts",
	"apps/cli/src/__tests__/three-particle-provenance.test.ts",
	"apps/cli/src/__tests__/liquid-object-broker.test.ts",
];
const production = [
	"packages/editor-contracts/src/programmatic-build.ts",
	"apps/cli/src/programmatic/three-capability.ts",
	"apps/cli/src/programmatic/three-liquid-object-identity.ts",
	"apps/cli/src/programmatic/three-liquid-object-provenance.ts",
	"apps/cli/src/programmatic/three-liquid-object-adapter.ts",
	"apps/cli/src/programmatic/engines/three-build-profile.ts",
	"apps/cli/src/programmatic/engines/three-toolchain-profile.ts",
	"apps/cli/src/programmatic/engines/three-liquid-object-capability.ts",
	"apps/cli/src/programmatic/engines/three-liquid-object-driver.ts",
	"apps/cli/src/programmatic/engines/three-liquid-object-compiler-plugin.ts",
	"apps/cli/src/programmatic/engines/compile-project.ts",
	"apps/cli/src/programmatic/engines/toolchain.ts",
	"apps/cli/src/programmatic/engines/remotion-compiler-child.ts",
	"apps/cli/src/programmatic/liquid-object-broker-codec.ts",
	"apps/cli/src/programmatic/liquid-object-broker.ts",
	"apps/cli/src/programmatic/liquid-object-frame-host.ts",
	"apps/cli/src/programmatic/liquid-object-capture.ts",
	"apps/cli/src/programmatic/liquid-object-browser-context.ts",
	"apps/cli/src/programmatic/liquid-object-browser-codec.ts",
	"apps/cli/src/programmatic/liquid-object-browser-runtime.ts",
	"apps/cli/src/programmatic/liquid-object-browser-module.ts",
	"apps/cli/src/programmatic/liquid-object-page-capture.ts",
];
const legacy = [
	"apps/cli/src/programmatic/three-particle-provenance.ts",
	"apps/cli/src/programmatic/html-document.ts",
	"apps/cli/src/programmatic/html-rasterizer.ts",
];
const inputs = [
	...new Set([
		...tests,
		...production,
		...legacy,
		"apps/cli/src/__tests__/three-liquid-object-provenance-fixture.ts",
		"apps/cli/src/__tests__/three-liquid-object-shared-compiler-fixture.ts",
		"apps/cli/src/__tests__/liquid-object-broker-fixture.ts",
		"script/fixtures/liquid-object-integration.tsconfig.json",
		"script/fixtures/liquid-object-integration-eslint.mjs",
		"script/fixtures/liquid-object-private-wasm-preload.mjs",
		"script/fixtures/liquid-object-browser.test.mjs",
		"script/fixtures/liquid-object-page.test.mjs",
	]),
].map((path) => join(workspace, path));
inputs.push(
	...[
		"opencut_wasm.d.ts",
		"opencut_wasm_sync.js",
		"opencut_wasm_bg.js",
		"opencut_wasm_bg.wasm",
	].map((name) => join(directory, name)),
);
const snapshot = () =>
	Promise.all(
		inputs.map(async (path) => {
			const bytes = await readFile(path);
			if (!path.endsWith(".wasm")) {
				const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
				assert(
					!text.includes("\ufffd") &&
						!bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])),
					path,
				);
			}
			return { path, bytes: bytes.length, sha256: sha(bytes) };
		}),
	);
const before = await snapshot();
assert.equal(
	before.find((file) => file.path === join(directory, "opencut_wasm_bg.wasm"))
		.sha256,
	expected,
);
const env = {
	...process.env,
	ROCUT_TEST_LIQUID_WASM_DIR: directory,
	ROCUT_TEST_LIQUID_WASM_SHA256: expected,
	ROCUT_TEST_THREE_TOOLCHAIN:
		"C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9",
};
const config = JSON.parse(
	await readFile(
		join(workspace, "script/fixtures/liquid-object-integration.tsconfig.json"),
		"utf8",
	),
);
config.extends = join(workspace, "apps/cli/tsconfig.json");
config.include = config.include.map((path) =>
	resolve(workspace, "script/fixtures", path),
);
config.compilerOptions.typeRoots = [join(workspace, "node_modules/@types")];
config.compilerOptions.paths = {
	"opencut-wasm": [join(directory, "opencut_wasm.d.ts")],
};
const privateConfig = join(root, "tsconfig.json");
await writeFile(privateConfig, JSON.stringify(config, null, 2), { flag: "wx" });
const commands = [];
async function run({ command, args, name }) {
	const start = Date.now();
	const result = spawnSync(command, args, {
		cwd: workspace,
		env,
		windowsHide: true,
		timeout: 120000,
		maxBuffer: 8 * 1024 * 1024,
	});
	await writeFile(
		join(root, name + ".log"),
		Buffer.concat([
			result.stdout ?? Buffer.alloc(0),
			result.stderr ?? Buffer.alloc(0),
		]),
		{ flag: "wx" },
	);
	commands.push({
		command,
		args,
		code: result.status,
		error: result.error?.message,
		durationMs: Date.now() - start,
		log: join(root, name + ".log"),
	});
}
await run({
	command: process.execPath,
	args: ["node_modules/typescript/bin/tsc", "--noEmit", "-p", privateConfig],
	name: "types",
});
await run({
	command: process.execPath,
	args: [
		"node_modules/eslint/bin/eslint.js",
		"--config",
		"script/fixtures/liquid-object-integration-eslint.mjs",
		...production,
		...tests.filter(
			(path) => !path.endsWith("three-particle-provenance.test.ts"),
		),
		"--max-warnings",
		"0",
	],
	name: "new-domain-lint",
});
await run({
	command: process.execPath,
	args: [
		"node_modules/eslint/bin/eslint.js",
		"--config",
		"script/fixtures/liquid-object-integration-eslint.mjs",
		...legacy,
		"--max-warnings",
		"0",
	],
	name: "legacy-shared-lint",
});
await run({
	command: "C:/Users/Sayo/.bun/bin/bun.exe",
	args: [
		"test",
		"--preload",
		"./script/fixtures/liquid-object-private-wasm-preload.mjs",
		...tests,
	],
	name: "behavior",
});
await run({
	command: process.execPath,
	args: [
		"--test",
		"script/fixtures/liquid-object-browser.test.mjs",
		"script/fixtures/liquid-object-page.test.mjs",
	],
	name: "browser-protocol",
});
const after = await snapshot();
const drift = before.filter((pin, index) => pin.sha256 !== after[index].sha256);
const receipt = {
	version: 1,
	scope:
		"same-byte scoped integration; real private WASM declaration/module routing, not browser GPU/export or installation",
	before,
	after,
	drift,
	commands,
	newDomainPassed:
		drift.length === 0 &&
		commands
			.filter((entry) => !entry.log.endsWith("legacy-shared-lint.log"))
			.every((entry) => entry.code === 0),
	allGatesPassed:
		drift.length === 0 && commands.every((entry) => entry.code === 0),
	legacyBoundary:
		"Existing shared positional APIs/type assertions are checked and reported, never suppressed or called green",
};
await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2), {
	flag: "wx",
});
console.log(
	JSON.stringify({
		root,
		newDomainPassed: receipt.newDomainPassed,
		allGatesPassed: receipt.allGatesPassed,
		drift: drift.length,
		commands: commands.map(({ log, code }) => ({ log, code })),
	}),
);
if (!receipt.allGatesPassed) process.exitCode = 1;
