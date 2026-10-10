import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const [pkg, esbuildPath] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	4,
	"Actual private WASM and existing esbuild only",
);
const esbuild = await import(pathToFileURL(esbuildPath).href);
async function load(relative) {
	const result = await esbuild.build({
		entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
		bundle: true,
		write: false,
		platform: "node",
		format: "esm",
		logLevel: "silent",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
	);
}
const { captureLiquidObjectWorkerSource } = await load(
	"../../apps/cli/src/programmatic/liquid-object-worker-source.ts",
);
const { spawnLiquidObjectProcess } = await load(
	"../../apps/cli/src/programmatic/liquid-object-worker-process.ts",
);
const { bootstrapLiquidObjectProcess } = await load(
	"../../apps/cli/src/programmatic/liquid-object-worker-bootstrap.ts",
);
const { createThreeLiquidObjectTransport } = await load(
	"../../apps/cli/src/programmatic/engines/three-liquid-object-transport.ts",
);
const frame = {
		sessionId: "actual-wasm-fixed-worker",
		index: 7,
		time: 1.5,
		seed: 29,
	},
	frameJson = JSON.stringify(frame);
const captured = captureLiquidObjectWorkerSource({
	moduleUrl: pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href,
	workerEntryUrl: new URL(
		"../../apps/cli/src/programmatic/liquid-object-worker-entry.mjs",
		import.meta.url,
	).href,
	layout: "source-sync",
});
const spawned = spawnLiquidObjectProcess(captured),
	controller = new AbortController();
let closed = false;
spawned.child.once("close", () => {
	closed = true;
});
const worker = await bootstrapLiquidObjectProcess({
	spawned,
	frameJson,
	bootstrapTimeoutMs: 5000,
	signal: controller.signal,
});
const transport = createThreeLiquidObjectTransport({
	frameJson,
	policyJson: worker.policyJson,
	admission: worker.admission,
	evaluate: worker.evaluate,
	signal: controller.signal,
});
const report = {
	ok: false,
	double: false,
	path: "production captured-source/spawn/bootstrap transport seam; canonical package untouched",
	identityBase: captured.identityBase,
	policyJson: worker.policyJson,
};
try {
	await transport.open();
	const payload = JSON.stringify({
		version: 1,
		params: { version: 1 },
		positions: [-1, 0, 0, 1, 0, 0, 0, 1, 0],
		time: frame.time,
		seed: frame.seed,
	});
	const result = JSON.parse(await transport.evaluate(payload));
	assert.equal(result.ok, true);
	assert.equal(result.frame.positions.length, 9);
	assert(result.frame.positions.every(Number.isFinite));
	report.geometry = result.frame;
	await transport.close();
	transport.check();
} finally {
	await transport.dispose();
}
assert(closed, "terminate must wait actual same-child close");
await assert.rejects(
	worker.admission.command(JSON.stringify({ operation: "open", frame })),
);
report.confirmedClose = closed;
report.terminalReplayRejected = true;
report.ok = true;
assert.equal(
	worker.policyJson,
	(
		await import(pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href)
	).liquidObjectTransportPolicyJson(),
);
const out = join(pkg, "..", "worker-acceptance.json");
await writeFile(out, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(
	JSON.stringify({ ok: report.ok, confirmedClose: closed, receipt: out }),
);
