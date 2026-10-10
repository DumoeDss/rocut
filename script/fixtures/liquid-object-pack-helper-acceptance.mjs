import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [pkg, esbuildPath, oldPkg] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	5,
	"Actual private WASM and existing esbuild only",
);
const esbuild = await import(pathToFileURL(esbuildPath).href);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const { buildLiquidObjectAssets, liquidObjectDefine } =
	await import("../pack-liquid-object.mjs");
const root = await mkdtemp("C:/tmps/liquid-object-pack-helper-");
const marker = "import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const build = async ({ entry, define = {} }) => {
	const result = await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		platform: "node",
		format: "esm",
		define,
		logLevel: "silent",
	});
	return result.outputFiles[0].text;
};
await buildLiquidObjectAssets({
	repoRoot,
	outDir: root,
	wasmSyncEntry: join(pkg, "opencut_wasm_sync.js"),
});
const sidecar = await readFile(join(root, "liquid-object-wasm.mjs"), "utf8");
const oldRoot = await mkdtemp("C:/tmps/liquid-object-pack-helper-old-");
await assert.rejects(
	buildLiquidObjectAssets({
		repoRoot,
		outDir: oldRoot,
		wasmSyncEntry: join(oldPkg, "opencut_wasm_sync.js"),
	}),
	/owner, evaluator and transport policy exports/,
);
await copyFile(
	join(pkg, "opencut_wasm_bg.wasm"),
	join(root, "opencut_wasm_bg.wasm"),
);
const entry = fileURLToPath(
	new URL(
		"../../apps/cli/src/programmatic/liquid-object-worker.ts",
		import.meta.url,
	),
);
const factoryCode = await build({
	entry,
	define: liquidObjectDefine,
});
assert(
	!factoryCode.includes("__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__"),
	"actual esbuild define must replace the direct import.meta marker",
);
await writeFile(join(root, "factory.mjs"), factoryCode, { flag: "wx" });
const { createLiquidObjectWorker } = await import(
	pathToFileURL(join(root, "factory.mjs")).href
);
const compiledTransport = await build({
	entry: fileURLToPath(
		new URL(
			"../../apps/cli/src/programmatic/engines/three-liquid-object-transport.ts",
			import.meta.url,
		),
	),
});
const { createThreeLiquidObjectTransport } = await import(
	`data:text/javascript;base64,${Buffer.from(compiledTransport).toString("base64")}`
);
const frame = {
		sessionId: "actual-defined-fixed-sidecar",
		index: 4,
		time: 0.75,
		seed: 11,
	},
	frameJson = JSON.stringify(frame);
const controller = new AbortController();
const worker = await createLiquidObjectWorker({
	frameJson,
	bootstrapTimeoutMs: 5000,
	signal: controller.signal,
});
assert.equal(worker.identity.layout, "packed-sidecar");
const transport = createThreeLiquidObjectTransport({
	frameJson,
	policyJson: worker.policyJson,
	admission: worker.admission,
	evaluate: worker.evaluate,
	signal: controller.signal,
});
try {
	await transport.open();
	const result = JSON.parse(
		await transport.evaluate(
			JSON.stringify({
				version: 1,
				params: { version: 1 },
				positions: [-1, 0, 0, 1, 0, 0, 0, 1, 0],
				time: frame.time,
				seed: frame.seed,
			}),
		),
	);
	assert.equal(result.ok, true);
	assert.equal(result.frame.positions.length, 9);
	await transport.close();
	transport.check();
} finally {
	await transport.dispose();
}
await assert.rejects(
	worker.admission.command(JSON.stringify({ operation: "open", frame })),
);
const replay = await createLiquidObjectWorker({
	frameJson: JSON.stringify({
		...frame,
		sessionId: "same-provenance-next-host-capture",
	}),
	bootstrapTimeoutMs: 5000,
	signal: new AbortController().signal,
	expectedIdentity: worker.identity,
});
assert.equal(replay.identity.identityHash, worker.identity.identityHash);
await replay.terminate();
const invalidCode = await build({
	entry,
	define: { [marker]: JSON.stringify("../not-the-fixed-sidecar.mjs") },
});
await writeFile(join(root, "invalid-factory.mjs"), invalidCode, { flag: "wx" });
const invalid = await import(
	pathToFileURL(join(root, "invalid-factory.mjs")).href
);
await assert.rejects(
	invalid.createLiquidObjectWorker({
		frameJson,
		bootstrapTimeoutMs: 5000,
		signal: new AbortController().signal,
	}),
	/fixed Liquid worker module literal/,
);
const wasmHash = hash(await readFile(join(root, "opencut_wasm_bg.wasm")));
assert.equal(wasmHash, hash(await readFile(join(pkg, "opencut_wasm_bg.wasm"))));
const receipt = {
	ok: true,
	double: false,
	root,
	actualFactory: true,
	formalPackHelper: true,
	oldPackageRejected: true,
	defineMarkerReplaced: true,
	fixedSidecar: true,
	expectedIdentityReplay: true,
	invalidLiteralRejected: true,
	terminationReturned: true,
	wasmHash,
	identity: worker.identity,
	factoryHash: hash(factoryCode),
	sidecarHash: hash(sidecar),
	sourceHash: hash(await readFile(entry)),
	limitations: [
		"No published pack-runtime artifacts or canonical dependency replacement",
		"Node runtime only; no browser/GPU",
	],
};
await writeFile(join(root, "evidence.json"), JSON.stringify(receipt, null, 2), {
	flag: "wx",
});
console.log(
	JSON.stringify({
		root,
		ok: true,
		wasmHash,
		receipt: join(root, "evidence.json"),
	}),
);
