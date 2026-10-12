import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import {
	mkdtemp,
	readFile,
	rm,
	writeFile,
	unlink,
	mkdir,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { productionWasmSha256 } from "../production-probe-wasm.mjs";
import {
	resolveNativeProbeWasm,
	assertNativeProbeWasmIdentity,
} from "../native-probe-wasm-binding.mjs";
import { stageNativeProbeWasm } from "../native-probe-wasm-staging.mjs";
import {
	createNativeProbeWasmPlugin,
	NATIVE_PRIVATE_WASM_ID,
} from "../native-probe-wasm-browser.mjs";

const production =
	process.env.ROCUT_TEST_LIQUID_WASM_DIR ??
	fileURLToPath(new URL("../../rust/wasm/pkg/", import.meta.url));
const select = () => resolveNativeProbeWasm({ directory: production, env: {} });
async function fixture(run) {
	const directory = await mkdtemp(join(tmpdir(), "rocut-native-binding-cpu-"));
	try {
		await run(directory);
	} finally {
		assert(
			resolve(directory).startsWith(resolve(tmpdir()) + "\\") ||
				resolve(directory).startsWith(resolve(tmpdir()) + "/"),
		);
		await rm(directory, { recursive: true, force: true });
	}
}

test("production authority stages the selected closure and physical Node worker resolves that same sync module", async () =>
	fixture(async (directory) => {
		const binding = select();
		assert.equal(binding.wasmSha256, productionWasmSha256);
		assert.equal(binding.lane, "production");
		const staged = await stageNativeProbeWasm({
			binding,
			runRoot: directory,
		});
		assert.deepEqual(staged.identity, binding.identity);
		const require = createRequire(join(directory, "host.mjs"));
		assert.equal(require.resolve("opencut-wasm/sync"), staged.syncEntry);
		const wasm = await import(pathToFileURL(staged.syncEntry).href);
		assert.equal(typeof wasm.resolveInkObjectParamsJson, "function");
		assert.equal(typeof wasm.resolveLiquidObjectParamsJson, "function");
		assert.equal(typeof wasm.LiquidObjectTransportOwner, "function");
		assert.equal(
			typeof JSON.parse(wasm.liquidObjectTransportPolicyJson()),
			"object",
		);
		assertNativeProbeWasmIdentity(staged);
	}));

test("empty, relative, conflicting and diagnostic overrides fail closed", () => {
	for (const directory of ["", ".", "relative/pkg"])
		assert.throws(
			() => resolveNativeProbeWasm({ directory, env: {} }),
			/absolute/,
		);
	assert.throws(
		() => resolveNativeProbeWasm({ env: { ROCUT_TEST_LIQUID_WASM_DIR: "" } }),
		/absolute/,
	);
	for (const sha of [
		"",
		"084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12",
		"01fe61d2".padEnd(64, "0"),
	])
		assert.throws(
			() =>
				resolveNativeProbeWasm({
					directory: production,
					env: { ROCUT_TEST_LIQUID_WASM_SHA256: sha },
				}),
			/override differs/,
		);
	assert.throws(
		() =>
			resolveNativeProbeWasm({
				directory: production,
				env: {
					ROCUT_TEST_LIQUID_WASM_DIR: ".",
					ROCUT_TEST_LIQUID_WASM_SHA256: productionWasmSha256,
				},
			}),
		/absolute/,
	);
	assert.throws(
		() =>
			resolveNativeProbeWasm({
				directory: production,
				env: { ROCUT_LIQUID_READBACK_PKG: "diagnostic" },
			}),
		/Diagnostic/,
	);
});

test("an explicit missing observed identity cannot become a self-attestation", () => {
	const binding = select();
	assert.throws(
		() => assertNativeProbeWasmIdentity(binding, undefined),
		/identity differs/,
	);
	assert.throws(
		() => assertNativeProbeWasmIdentity(binding, []),
		/identity differs/,
	);
});

test("stale binary and changed staged glue are rejected before acceptance", async () =>
	fixture(async (directory) => {
		const binding = select();
		const staged = await stageNativeProbeWasm({
			binding,
			runRoot: directory,
		});
		await writeFile(
			staged.syncEntry,
			(await readFile(staged.syncEntry)) + "\n// changed fixture\n",
		);
		assert.throws(
			() => assertNativeProbeWasmIdentity(staged),
			/changed during probe/,
		);
		await writeFile(
			join(staged.directory, "opencut_wasm_bg.wasm"),
			Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0),
		);
		assert.throws(
			() => resolveNativeProbeWasm({ directory: staged.directory, env: {} }),
			/binary differs/,
		);
	}));

test("package declaration, incomplete sibling closure and incompatible glue cannot pass", async () =>
	fixture(async (directory) => {
		const staged = await stageNativeProbeWasm({
			binding: select(),
			runRoot: directory,
		});
		const manifestPath = join(staged.directory, "package.json"),
			bytes = await readFile(manifestPath);
		const manifest = JSON.parse(bytes);
		manifest.exports["./sync"].default = "./elsewhere.js";
		await writeFile(manifestPath, JSON.stringify(manifest));
		assert.throws(
			() => resolveNativeProbeWasm({ directory: staged.directory, env: {} }),
			/sync declaration/,
		);
		await writeFile(manifestPath, bytes);
		const gluePath = join(staged.directory, "opencut_wasm_bg.js"),
			glue = await readFile(gluePath);
		await writeFile(gluePath, glue + "\n// wasm.not_in_the_selected_binary\n");
		assert.throws(
			() => resolveNativeProbeWasm({ directory: staged.directory, env: {} }),
			/ABI missing/,
		);
		await writeFile(gluePath, glue);
		await unlink(join(staged.directory, "opencut_wasm.d.ts"));
		assert.throws(
			() => resolveNativeProbeWasm({ directory: staged.directory, env: {} }),
			/ENOENT/,
		);
	}));

test("browser wrapper hashes fetched bytes before recording the selected native identity", async () => {
	const binding = select(),
		plugin = createNativeProbeWasmPlugin(binding);
	const source = plugin.load(plugin.resolveId(NATIVE_PRIVATE_WASM_ID));
	const executable = source
		.replace(/^import .*;\n/gm, "")
		.replace(/^export \* from .*;$/m, "");
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	const run = new AsyncFunction(
			"wasmUrl",
			"fetch",
			"crypto",
			"globalThis",
			executable,
		),
		observed = {};
	await assert.rejects(
		run(
			"/selected.wasm",
			async () => new Response(Uint8Array.of(99)),
			webcrypto,
			observed,
		),
		/differs/,
	);
	assert.equal(observed.__nativeProbeWasmIdentity, undefined);
	const bytes = await readFile(join(binding.directory, "opencut_wasm_bg.wasm"));
	await run(
		"/selected.wasm",
		async () => new Response(bytes),
		webcrypto,
		observed,
	);
	assert.deepEqual(observed.__nativeProbeWasmIdentity, binding.identity);
});

test("all object lanes consume the private binding rather than an installed-package copy", async () => {
	for (const family of ["ink", "liquid"]) {
		for (const suffix of ["", "-full"]) {
			const source = await readFile(
				new URL(
					`../probe-${family}-object-editor-export${suffix}.mjs`,
					import.meta.url,
				),
				"utf8",
			);
			assert.match(source, /stageNativeProbeWasm/);
			assert.match(source, /staged\.syncEntry/);
			assert.doesNotMatch(source, /installedWasm/);
		}
	}
	for (const name of [
		"probe-liquid-editor.mjs",
		"probe-liquid-editor-full-export.mjs",
	]) {
		const source = await readFile(
			new URL("../" + name, import.meta.url),
			"utf8",
		);
		assert.match(source, /resolveProductionProbeWasm/);
		assert.match(
			source,
			/assertHtmlProbeWasmIdentity\(binding, evidence\.hostWasmIdentity\)/,
		);
		assert.match(
			source,
			/assertHtmlProbeWasmIdentity\(binding, evidence\.browserWasmIdentity\)/,
		);
		assert.match(source, /if \(error instanceof SyntaxError\) continue/);
	}
});

test("staging rejects redirected parents and refuses to overwrite any existing package", async () =>
	fixture(async (directory) => {
		const binding = select(),
			root = join(directory, "run"),
			target = join(directory, "redirected");
		await mkdir(root);
		await mkdir(target);
		await symlink(target, join(root, "node_modules"), "junction");
		await assert.rejects(
			stageNativeProbeWasm({ binding, runRoot: root }),
			/redirected/,
		);
		const staged = await stageNativeProbeWasm({ binding, runRoot: directory });
		await assert.rejects(
			stageNativeProbeWasm({ binding, runRoot: directory }),
			/EEXIST/,
		);
		assertNativeProbeWasmIdentity(staged);
		await assert.rejects(
			stageNativeProbeWasm({ binding, runRoot: "." }),
			/absolute/,
		);
	}));
