import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { webcrypto, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
	resolveHtmlProbeWasmBinding,
	assertHtmlProbeWasmIdentity,
	createHtmlProbeWasmPlugin,
	HTML_PRIVATE_WASM_ID,
	resolveHtmlProbeArtifactDirectory,
	snapshotHtmlProbeSources,
	saveHtmlProbeEvidence,
} from "./html-probe-wasm-binding.mjs";

test("explicit artifact directory never falls back for empty, relative, missing or file inputs", () => {
	assert.equal(resolveHtmlProbeArtifactDirectory(undefined), undefined);
	for (const value of ["", ".", "relative/artifacts", null])
		assert.throws(() => resolveHtmlProbeArtifactDirectory(value), /absolute/);
	fixture((directory) => {
		assert.equal(resolveHtmlProbeArtifactDirectory(directory), directory);
		assert.throws(() =>
			resolveHtmlProbeArtifactDirectory(join(directory, "missing")),
		);
		assert.throws(
			() =>
				resolveHtmlProbeArtifactDirectory(join(directory, "opencut_wasm.js")),
			/ordinary directory/,
		);
	});
});

test("normal runner evidence schema pins success, WASM and source inputs; wx preserves previous evidence", async () => {
	const directory = mkdtempSync(join(tmpdir(), "rocut-html-evidence-test-"));
	try {
		writeFileSync(join(directory, "input.mjs"), "export const value = 1;\n");
		writeFileSync(
			join(directory, "opencut_wasm.js"),
			"export default function init() {}\n",
		);
		writeFileSync(
			join(directory, "opencut_wasm_bg.wasm"),
			Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
		);
		writeFileSync(
			join(directory, "opencut_wasm.d.ts"),
			"export function init(): void;\n",
		);
		const binding = resolveHtmlProbeWasmBinding(directory);
		const sourceInputs = snapshotHtmlProbeSources(directory, ["input.mjs"]);
		const request = {
			directory,
			binding,
			result: {
				passed: true,
				wasmIdentity: binding.identity,
				checks: ["resource", "font", "cancel-recovery"],
			},
			browser: "CPU-schema-double",
			frameBackend: "private-chromium",
			root: directory,
			sourceInputs,
		};
		await saveHtmlProbeEvidence(request);
		const saved = readFileSync(join(directory, "evidence.json"), "utf8"),
			evidence = JSON.parse(saved);
		assert.equal(evidence.passed, true);
		assert.equal(evidence.wasmBinding, "explicit-private");
		assert.deepEqual(evidence.wasmIdentity, binding.identity);
		assert.equal(evidence.electronTested, false);
		assert.equal(evidence.frameBackend, request.frameBackend);
		assert.deepEqual(evidence.sourceInputs, sourceInputs);
		assert.deepEqual(evidence.checks, request.result.checks);
		assert.equal(evidence.limitations.length, 2);
		await assert.rejects(saveHtmlProbeEvidence(request), { code: "EEXIST" });
		assert.equal(readFileSync(join(directory, "evidence.json"), "utf8"), saved);
		await assert.rejects(
			saveHtmlProbeEvidence({ ...request, result: { passed: false } }),
			/unsuccessful/,
		);
		await assert.rejects(
			saveHtmlProbeEvidence({
				...request,
				result: { ...request.result, wasmIdentity: {} },
			}),
			/identity differs/,
		);
		writeFileSync(join(directory, "input.mjs"), "export const value = 2;\n");
		await assert.rejects(
			saveHtmlProbeEvidence(request),
			/source inputs changed/,
		);
	} finally {
		rmSync(directory, { recursive: true });
	}
	const runner = readFileSync(
		new URL("./probe-html-frames.mjs", import.meta.url),
		"utf8",
	);
	assert.ok(
		runner.includes("!threeScene && !threeResources && artifactDirectory"),
	);
	assert.ok(runner.includes("await saveHtmlProbeEvidence"));
});

function fixture(run) {
	const directory = mkdtempSync(
		join(tmpdir(), "rocut-html-wasm-binding-test-"),
	);
	try {
		writeFileSync(
			join(directory, "opencut_wasm.js"),
			"export default function init() {}\n",
		);
		writeFileSync(
			join(directory, "opencut_wasm_bg.wasm"),
			Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
		);
		writeFileSync(
			join(directory, "opencut_wasm.d.ts"),
			"export function init(): void;\n",
		);
		return run(directory);
	} finally {
		rmSync(directory, { recursive: true });
	}
}
test("only absent env selects compatibility mode; relative/empty/missing/incomplete paths reject", () => {
	assert.equal(resolveHtmlProbeWasmBinding(undefined), undefined);
	for (const value of ["", ".", "relative/wasm", null])
		assert.throws(() => resolveHtmlProbeWasmBinding(value), /absolute/);
	fixture((directory) => {
		assert.throws(() =>
			resolveHtmlProbeWasmBinding(join(directory, "missing")),
		);
		rmSync(join(directory, "opencut_wasm.d.ts"));
		assert.throws(() => resolveHtmlProbeWasmBinding(directory));
	});
});
test("directory and binary shape failures never silently bind shared WASM", () => {
	fixture((directory) => {
		assert.throws(
			() => resolveHtmlProbeWasmBinding(join(directory, "opencut_wasm.js")),
			/directory/,
		);
		writeFileSync(
			join(directory, "opencut_wasm_bg.wasm"),
			Buffer.from("not-wasm"),
		);
		assert.throws(() => resolveHtmlProbeWasmBinding(directory), /header/);
		writeFileSync(join(directory, "opencut_wasm.js"), "");
		assert.throws(() => resolveHtmlProbeWasmBinding(directory), /empty/);
	});
});
test("browser wrapper imports private module, hashes actual fetch before initialization and stamps run identity", () => {
	fixture((directory) => {
		const binding = resolveHtmlProbeWasmBinding(directory),
			plugin = createHtmlProbeWasmPlugin(binding);
		const id = plugin.resolveId(HTML_PRIVATE_WASM_ID),
			source = plugin.load(id);
		assert.equal(plugin.resolveId("opencut-wasm"), undefined);
		assert.equal(plugin.load("unrelated"), undefined);
		assert.ok(source.includes(JSON.stringify(binding.entry)));
		assert.ok(source.includes("crypto.subtle.digest"));
		assert.ok(source.indexOf("if (hash !==") < source.indexOf("await init("));
		assert.ok(
			source.indexOf("await init(") <
				source.indexOf("globalThis.__htmlProbeWasmIdentity"),
		);
		assert.ok(!source.includes("rust/wasm/pkg"));
		assertHtmlProbeWasmIdentity(binding, binding.identity);
		assert.throws(
			() => assertHtmlProbeWasmIdentity(binding, {}),
			/identity differs/,
		);
		writeFileSync(
			join(directory, "opencut_wasm.js"),
			"export default function changed() {}\n",
		);
		assert.throws(() => plugin.load(id), /changed during/);
	});
});
test("runner wires private alias and host/browser identity gates; defaults retain shared import", () => {
	const runner = readFileSync(
			new URL("./probe-html-frames.mjs", import.meta.url),
			"utf8",
		),
		preload = readFileSync(
			new URL("./fixtures/local-wasm-preload.mjs", import.meta.url),
			"utf8",
		);
	assert.match(runner, /wasmBinding\s*\?\s*HTML_PRIVATE_WASM_ID/);
	assert.ok(runner.includes("hostWasmIdentity"));
	assert.ok(runner.includes("globalThis.__htmlProbeWasmIdentity"));
	assert.ok(
		preload.includes(
			'await import("../../rust/wasm/pkg/opencut_wasm_sync.js")',
		),
	);
	assert.ok(preload.includes("actual.initSync"));
});

test("browser wrapper rejects wrong served bytes before init and stamps only successfully initialized exact bytes", async () => {
	const prepared = fixture((directory) => {
		const binding = resolveHtmlProbeWasmBinding(directory),
			plugin = createHtmlProbeWasmPlugin(binding),
			source = plugin.load(plugin.resolveId(HTML_PRIVATE_WASM_ID));
		return {
			binding,
			source: source
				.replace(/^import .*;$/gm, "")
				.replace(/^export \* .*;$/gm, ""),
		};
	});
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	const evaluate = new AsyncFunction(
		"init",
		"wasmUrl",
		"fetch",
		"crypto",
		"globalThis",
		prepared.source,
	);
	let initialized = 0;
	const global = {},
		init = async () => {
			initialized++;
		};
	const response = (bytes) => async () => ({
		ok: true,
		arrayBuffer: async () => Uint8Array.from(bytes).buffer,
	});
	await assert.rejects(
		evaluate(init, "/private.wasm", response([1]), webcrypto, global),
		/Served private WASM/,
	);
	assert.equal(initialized, 0);
	assert.equal(global.__htmlProbeWasmIdentity, undefined);
	await evaluate(
		init,
		"/private.wasm",
		response([0, 97, 115, 109, 1, 0, 0, 0]),
		webcrypto,
		global,
	);
	assert.equal(initialized, 1);
	assert.deepEqual(global.__htmlProbeWasmIdentity, prepared.binding.identity);
});
test(
	"actual private Rust web-target preload initializes one module and reports exact current binary identity",
	{
		skip:
			process.env.ROCUT_TEST_WASM_DIRECTORY === undefined
				? "Provide the already-built private WASM for native CPU integration"
				: false,
	},
	() => {
		const binding = resolveHtmlProbeWasmBinding(
			process.env.ROCUT_TEST_WASM_DIRECTORY,
		);
		const result = spawnSync(
			"bun",
			[
				"--preload",
				fileURLToPath(
					new URL("./fixtures/local-wasm-preload.mjs", import.meta.url),
				),
				"-e",
				'import { MvImagePreprocessOwner } from "opencut-wasm"; const owner = new MvImagePreprocessOwner(); owner.admit(16); owner.free(); console.log("native-binding-ok");',
			],
			{ encoding: "utf8", windowsHide: true, timeout: 15000, env: process.env },
		);
		assert.equal(result.status, 0, result.stderr);
		const lines = result.stdout.trim().split(/\r?\n/);
		assertHtmlProbeWasmIdentity(binding, JSON.parse(lines[0]).wasmIdentity);
		assert.equal(lines[1], "native-binding-ok");
	},
);

test(
	"actual Vite HTTP wrapper -> ?url module -> raw Windows private WASM route serves pinned bytes",
	{
		skip:
			process.env.ROCUT_TEST_WASM_DIRECTORY === undefined
				? "Provide the existing private WASM directory"
				: false,
	},
	async () => {
		const { createServer, wasm, topLevelAwait } =
			await import("./browser-probe-toolchain.mjs");
		const binding = resolveHtmlProbeWasmBinding(
			process.env.ROCUT_TEST_WASM_DIRECTORY,
		);
		const server = await createServer({
			root: process.cwd(),
			configFile: false,
			logLevel: "silent",
			plugins: [createHtmlProbeWasmPlugin(binding), wasm(), topLevelAwait()],
			optimizeDeps: { noDiscovery: true, include: [] },
			server: {
				host: "127.0.0.1",
				port: 0,
				hmr: false,
				fs: { allow: [process.cwd(), binding.directory] },
			},
		});
		try {
			await server.listen();
			const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
			const wrapper = await fetch(
				origin + "/@id/__x00__" + HTML_PRIVATE_WASM_ID,
			);
			assert.equal(wrapper.status, 200);
			const code = await wrapper.text();
			const moduleUrl = JSON.parse(
				code.match(/import wasmUrl from ("[^"]+");/)[1],
			);
			const module = await fetch(new URL(moduleUrl, origin));
			assert.equal(module.status, 200);
			const assetUrl = JSON.parse(
				(await module.text()).match(/export default ("[^"]+")/)[1],
			);
			const binary = await fetch(new URL(assetUrl, origin));
			assert.equal(
				binary.status,
				200,
				`Generated private WASM route failed: ${assetUrl}`,
			);
			assert.match(binary.headers.get("content-type"), /application\/wasm/);
			const bytes = Buffer.from(await binary.arrayBuffer());
			const expected = binding.identity.files.find((file) =>
				file.name.endsWith(".wasm"),
			);
			assert.equal(bytes.length, expected.byteLength);
			assert.equal(
				createHash("sha256").update(bytes).digest("hex"),
				expected.sha256,
			);
			const unrelated = await fetch(
				new URL(
					assetUrl.replace("opencut_wasm_bg.wasm", "missing-private.wasm"),
					origin,
				),
			);
			assert.equal(unrelated.status, 404);
			assertHtmlProbeWasmIdentity(binding, binding.identity);
		} finally {
			await server.close();
		}
	},
);
