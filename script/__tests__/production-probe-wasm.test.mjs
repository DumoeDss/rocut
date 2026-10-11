import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
	productionWasmDirectory,
	productionWasmSha256,
	resolveProductionProbeWasm,
} from "../production-probe-wasm.mjs";
import {
	createHtmlProbeWasmPlugin,
	HTML_PRIVATE_WASM_ID,
} from "../html-probe-wasm-binding.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("production binding defaults to the exact clean-LF web package", () => {
	const binding = resolveProductionProbeWasm({});
	assert.equal(
		binding.directory.replaceAll("\\", "/"),
		productionWasmDirectory,
	);
	assert.equal(
		binding.identity.files.find((file) => file.name.endsWith(".wasm")).sha256,
		productionWasmSha256,
	);
});

test("old authority, empty paths, and wrong package cannot silently fall back", () => {
	assert.throws(
		() =>
			resolveProductionProbeWasm({
				ROCUT_PROBE_WASM_SHA256:
					"084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12",
			}),
		/override differs/,
	);
	assert.throws(
		() => resolveProductionProbeWasm({ ROCUT_TEST_WASM_DIRECTORY: "" }),
		/explicit/,
	);
	assert.throws(
		() => resolveProductionProbeWasm({ ROCUT_PROBE_WASM_SHA256: "" }),
		/override differs/,
	);
	assert.throws(
		() =>
			resolveProductionProbeWasm({
				ROCUT_TEST_WASM_DIRECTORY:
					"C:/Users/Sayo/AppData/Local/Temp/rocut-wasm-authority-20261011-GVDTX4/browser-pkg-v2-sntQBC",
			}),
		/binary differs/,
	);
});

test("byte mismatch blocks initialization and cannot stamp production identity", async () => {
	const binding = resolveProductionProbeWasm({}),
		plugin = createHtmlProbeWasmPlugin(binding);
	const source = plugin.load(plugin.resolveId(HTML_PRIVATE_WASM_ID));
	const executable = source
		.replace(/^import init from .*;\n/m, "")
		.replace(/^import wasmUrl from .*;\n/m, "")
		.replace(/^export \* from .*;$/m, "");
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	const run = new AsyncFunction(
		"init",
		"wasmUrl",
		"fetch",
		"crypto",
		"globalThis",
		executable,
	);
	let initialized = 0;
	const observed = {};
	await assert.rejects(
		run(
			async () => {
				initialized++;
			},
			"/binary.wasm",
			async () => new Response(Uint8Array.of(99)),
			webcrypto,
			observed,
		),
		/differs/,
	);
	assert.equal(initialized, 0);
	assert.equal(observed.__htmlProbeWasmIdentity, undefined);
});

test("actual Vite HTTP wrapper and asset response serve the clean-LF authority bytes", async () => {
	// External projections can borrow installed read-only tools without copying dependencies.
	const toolchainUrl = process.env.ROCUT_PRODUCTION_MIGRATION_TOOLCHAIN
		? pathToFileURL(process.env.ROCUT_PRODUCTION_MIGRATION_TOOLCHAIN).href
		: new URL("../browser-probe-toolchain.mjs", import.meta.url).href;
	const { createServer, wasm, topLevelAwait } = await import(toolchainUrl);
	const binding = resolveProductionProbeWasm({});
	const server = await createServer({
		root: process.cwd(),
		configFile: false,
		logLevel: "silent",
		cacheDir:
			process.env.ROCUT_PRODUCTION_MIGRATION_CACHE ??
			"node_modules/.vite-production-wasm-test",
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
		const wrapper = await fetch(origin + "/@id/__x00__" + HTML_PRIVATE_WASM_ID);
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
		const response = await fetch(new URL(assetUrl, origin));
		assert.equal(response.status, 200);
		const bytes = Buffer.from(await response.arrayBuffer());
		assert.equal(bytes.length, 15069189);
		assert.equal(sha(bytes), productionWasmSha256);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.match(response.headers.get("content-type"), /application\/wasm/);
		const head = await fetch(new URL(assetUrl, origin), { method: "HEAD" });
		assert.equal(head.status, 200);
		assert.equal(head.headers.get("content-length"), String(bytes.length));
		assert.equal((await head.arrayBuffer()).byteLength, 0);
		const unrelated = await fetch(
			new URL(
				assetUrl.replace("opencut_wasm_bg.wasm", "missing-private.wasm"),
				origin,
			),
		);
		assert.equal(unrelated.status, 404);
		const proof = {
			browserLaunched: false,
			actualHttpBody: true,
			wrapperStatus: wrapper.status,
			assetUrl,
			getStatus: response.status,
			bytes: bytes.length,
			sha256: sha(bytes),
			headStatus: head.status,
			unrelatedStatus: unrelated.status,
			productionWasmDirectory,
		};
		if (process.env.ROCUT_PRODUCTION_MIGRATION_HTTP_PROOF)
			await writeFile(
				process.env.ROCUT_PRODUCTION_MIGRATION_HTTP_PROOF,
				JSON.stringify(proof, null, 2) + "\n",
				{ flag: "wx" },
			);
	} finally {
		await server.close();
	}
});
