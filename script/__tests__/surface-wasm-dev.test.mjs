import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	resolveSurfaceWasmPackage,
	surfaceWasmPackagePlugin,
} from "../surface-wasm-package.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function selectedClosure() {
	const wasmPackageDirectory =
		process.env.ROCUT_SURFACE_WASM_PACKAGE_DIR ??
		join(repoRoot, "rust/wasm/pkg");
	return resolveSurfaceWasmPackage({
		repoRoot,
		wasmPackageDirectory,
		outDir: join(repoRoot, "apps/vite-example/dist"),
	});
}

test("selected WASM dev response serves only its exact binary URL without SPA fallback", async () => {
	const closure = selectedClosure();
	let middleware;
	const plugin = surfaceWasmPackagePlugin(closure);
	assert.equal(plugin.apply, undefined);
	plugin.configureServer({
		middlewares: {
			use: (handler) => {
				middleware = handler;
			},
		},
	});
	const server = createServer((request, response) => {
		middleware(request, response, (error) => {
			response.statusCode = error ? 500 : 404;
			response.end(error ? error.message : "not selected");
		});
	});
	try {
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const origin = `http://127.0.0.1:${server.address().port}`;
		const binaryPath = `/@fs/${closure.wasmBinary.replaceAll("\\", "/")}`;
		const response = await fetch(origin + binaryPath);
		const bytes = Buffer.from(await response.arrayBuffer());
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-type"), "application/wasm");
		assert.equal(response.headers.get("cache-control"), "no-cache");
		assert.equal(Number(response.headers.get("content-length")), bytes.length);
		assert.equal(bytes.subarray(0, 4).toString("hex"), "0061736d");
		assert.equal(
			createHash("sha256").update(bytes).digest("hex"),
			closure.files.find((file) => file.name.endsWith(".wasm")).sha256,
		);
		const head = await fetch(origin + binaryPath, { method: "HEAD" });
		assert.equal(head.status, 200);
		assert.equal((await head.arrayBuffer()).byteLength, 0);
		for (const path of [
			`${binaryPath}?import`,
			`${binaryPath}?url`,
			`${binaryPath}.js`,
			"/@fs/another/package.wasm",
			"/@fs/%malformed",
		])
			assert.equal((await fetch(origin + path)).status, 404, path);
		assert.equal(
			(await fetch(origin + binaryPath, { method: "POST" })).status,
			404,
		);
	} finally {
		await new Promise((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

test("selected WASM retains strict production emission checks without scratch copies", () => {
	const closure = selectedClosure();
	const plugin = surfaceWasmPackagePlugin(closure);
	const binary = readFileSync(closure.wasmBinary);
	let receipt;
	const context = {
		emitFile: (value) => {
			receipt = value;
		},
	};
	const asset = { type: "asset", fileName: "assets/core.wasm", source: binary };
	plugin.generateBundle.call(context, {}, { core: asset });
	assert.equal(receipt.fileName, "surface-wasm-package.json");
	const parsed = JSON.parse(receipt.source);
	assert.deepEqual(parsed.coreWasm, {
		path: asset.fileName,
		sha256: createHash("sha256").update(binary).digest("hex"),
	});
	assert.throws(
		() => plugin.generateBundle.call(context, {}, {}),
		/exactly once/,
	);
	assert.throws(
		() =>
			plugin.generateBundle.call(context, {}, { first: asset, second: asset }),
		/exactly once/,
	);
	assert.throws(
		() =>
			plugin.generateBundle.call(
				context,
				{},
				{ core: { ...asset, source: Buffer.from([0, 97, 115, 109]) } },
			),
		/exactly once/,
	);
	const drifted = surfaceWasmPackagePlugin({
		...closure,
		bundlerEntrySha256: "0".repeat(64),
	});
	assert.throws(
		() => drifted.generateBundle.call(context, {}, { core: asset }),
		/bundler entry changed/,
	);
	assert.throws(
		() => drifted.configureServer({ middlewares: { use() {} } }),
		/bundler entry changed/,
	);
});
