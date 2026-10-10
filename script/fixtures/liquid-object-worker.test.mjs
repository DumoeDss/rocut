import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
	fixture,
	request,
	nativeModule,
	policyJson,
	frame,
	frameJson,
	workerEntrySource,
	spawnLiquidObjectProcess,
	bootstrapLiquidObjectProcess,
	captureLiquidObjectWorkerSource,
} from "./liquid-object-worker-support.mjs";

test("actual native Rust owner/evaluator roundtrip crosses fixed production worker IPC and confirmed close", async () => {
	const f = await fixture();
	try {
		assert.equal(f.worker.policyJson, policyJson);
		await f.transport.open();
		const reply = JSON.parse(await f.transport.evaluate(request()));
		assert.equal(reply.ok, true);
		assert.equal(reply.frame.positions.length, 9);
		await f.transport.close();
		f.transport.check();
	} finally {
		await f.transport.dispose();
	}
	assert.equal(f.closed, true);
	await assert.rejects(
		f.worker.admission.command(JSON.stringify({ operation: "open", frame })),
	);
});
test("mixed-case NODE_OPTIONS/BUN_OPTIONS are stripped from the owned child environment", async () => {
	const previous = {
		node: process.env.NoDe_OpTiOnS,
		bun: process.env.BuN_OpTiOnS,
	};
	process.env.NoDe_OpTiOnS = "--not-a-valid-runtime-option";
	process.env.BuN_OpTiOnS = "--not-a-valid-runtime-option";
	try {
		const f = await fixture();
		await f.transport.open();
		await f.transport.close();
		await f.transport.dispose();
		assert(f.closed);
	} finally {
		if (previous.node === undefined) delete process.env.NoDe_OpTiOnS;
		else process.env.NoDe_OpTiOnS = previous.node;
		if (previous.bun === undefined) delete process.env.BuN_OpTiOnS;
		else process.env.BuN_OpTiOnS = previous.bun;
	}
});
test("abort interrupts a synchronous looping test evaluator and disposal waits actual owned process close", async () => {
	const f = await fixture({ source: nativeModule({ loop: true }) });
	await f.transport.open();
	const work = f.transport.evaluate(request());
	setTimeout(() => f.controller.abort(Error("test capture cancellation")), 100);
	await assert.rejects(work);
	await assert.rejects(f.transport.dispose());
	assert(f.closed);
	await assert.rejects(f.worker.evaluate("{}", new AbortController().signal));
});
test("bootstrap timeout rejects permanently and waits confirmed close of a looping import test double", async () => {
	const spawned = spawnLiquidObjectProcess({
		workerEntrySource,
		moduleUrl: `data:text/javascript;base64,${Buffer.from("while(true){}").toString("base64")}`,
	});
	let closed = false;
	spawned.child.once("close", () => {
		closed = true;
	});
	await assert.rejects(
		bootstrapLiquidObjectProcess({
			spawned,
			frameJson,
			bootstrapTimeoutMs: 100,
			signal: new AbortController().signal,
		}),
		/deadline/,
	);
	assert(closed);
	await assert.rejects(spawned.command("{}"));
});
test("wrong mapped frame and unreserved evaluation fail closed before native kernel execution", async () => {
	const f = await fixture();
	await f.transport.open();
	const envelope = JSON.stringify({
		version: 1,
		identity: { frame: { ...frame, index: frame.index + 1 }, requestId: 1 },
		payloadJson: request(),
	});
	await assert.rejects(
		f.worker.evaluate(envelope, new AbortController().signal),
	);
	await f.worker.terminate();
	assert(f.closed);
	await f.transport.dispose();
});
test("actual existing WASM missing opaque owner/policy exports is rejected and process closes", async () => {
	const modulePath = process.env.LIQUID_WORKER_WASM_SYNC;
	if (!modulePath)
		throw Error(
			"Actual existing private WASM path required; no skipped acceptance",
		);
	const captured = captureLiquidObjectWorkerSource({
		moduleUrl: pathToFileURL(modulePath).href,
		workerEntryUrl: new URL(
			"../../apps/cli/src/programmatic/liquid-object-worker-entry.mjs",
			import.meta.url,
		).href,
		layout: "source-sync",
	});
	assert(
		captured.identityBase.files.every((file) =>
			/^[a-f0-9]{64}$/.test(file.sha256),
		),
	);
	const spawned = spawnLiquidObjectProcess(captured);
	let closed = false;
	spawned.child.once("close", () => {
		closed = true;
	});
	await assert.rejects(
		bootstrapLiquidObjectProcess({
			spawned,
			frameJson,
			bootstrapTimeoutMs: 5000,
			signal: new AbortController().signal,
		}),
		/rejected|closed/,
	);
	assert(closed);
});
test("actual request bytes differing from the Rust reservation reject before evaluation", async () => {
	const f = await fixture();
	await f.transport.open();
	const identity = { frame, requestId: 1 },
		payloadJson = request();
	const envelope = JSON.stringify({ version: 1, identity, payloadJson });
	const accepted = JSON.parse(
		await f.worker.admission.command(
			JSON.stringify({
				operation: "reserve",
				identity,
				meshId: 1,
				vertices: 3,
				requestJsonBytes: Buffer.byteLength(payloadJson) - 1,
				requestEnvelopeBytes: Buffer.byteLength(envelope),
			}),
		),
	);
	assert.equal(accepted.ok, true);
	await assert.rejects(
		f.worker.evaluate(envelope, new AbortController().signal),
	);
	await f.worker.terminate();
	assert(f.closed);
	await f.transport.dispose();
});
test("settlement must match actual UTF-8 kernel reply bytes retained by the same worker", async () => {
	const f = await fixture();
	await f.transport.open();
	const identity = { frame, requestId: 1 },
		payloadJson = request();
	const envelope = JSON.stringify({ version: 1, identity, payloadJson });
	await f.worker.admission.command(
		JSON.stringify({
			operation: "reserve",
			identity,
			meshId: 1,
			vertices: 3,
			requestJsonBytes: Buffer.byteLength(payloadJson),
			requestEnvelopeBytes: Buffer.byteLength(envelope),
		}),
	);
	const response = await f.worker.evaluate(
		envelope,
		new AbortController().signal,
	);
	await assert.rejects(
		f.worker.admission.command(
			JSON.stringify({
				operation: "settle",
				identity,
				responseJsonBytes:
					Buffer.byteLength(JSON.parse(response).payloadJson) - 1,
				responseEnvelopeBytes: Buffer.byteLength(response),
			}),
		),
	);
	await f.worker.terminate();
	assert(f.closed);
	await f.transport.dispose();
});
