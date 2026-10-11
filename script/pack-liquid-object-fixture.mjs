import assert from "node:assert/strict";
import { createLiquidObjectWorker } from "../apps/cli/src/programmatic/liquid-object-worker.ts";
import { threeLiquidObjectCapability } from "../apps/cli/src/programmatic/engines/three-liquid-object-capability.ts";

const mode = process.argv[2] ?? "success";
const frame = {
	sessionId: "plain-node-packed-liquid",
	index: 4,
	time: 0.75,
	seed: 11,
};
const options = {
	frameJson: JSON.stringify(frame),
	bootstrapTimeoutMs: 5000,
	signal: new AbortController().signal,
};
if (mode === "missing" || mode === "invalid-literal") {
	await assert.rejects(
		createLiquidObjectWorker(options),
		mode === "invalid-literal"
			? /fixed Liquid worker module literal/
			: undefined,
	);
	console.log(JSON.stringify({ mode, rejected: true }));
} else {
	const capability = threeLiquidObjectCapability({
		toolchainConfigured: true,
		executable: "C:/fixtures/chrome.exe",
	});
	assert.equal(capability.compile, "configured-not-health-probed");
	const worker = await createLiquidObjectWorker(options);
	assert.equal(worker.identity.layout, "packed-sidecar");
	assert.equal(worker.identity.runtime.name, "node");
	// Force production splitting: transport and factory may live in different
	// root-level chunks, but both must resolve the same fixed sibling closure.
	const { createThreeLiquidObjectTransport } =
		await import("../apps/cli/src/programmatic/engines/three-liquid-object-transport.ts");
	const transport = createThreeLiquidObjectTransport({
		...options,
		policyJson: worker.policyJson,
		admission: worker.admission,
		evaluate: worker.evaluate,
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
		...options,
		expectedIdentity: worker.identity,
	});
	assert.equal(replay.identity.identityHash, worker.identity.identityHash);
	await replay.terminate();
	console.log(
		JSON.stringify({
			mode,
			capability,
			layout: worker.identity.layout,
			workerBytesCaptured: true,
			identityReplay: true,
			terminated: true,
			identity: worker.identity,
		}),
	);
}
