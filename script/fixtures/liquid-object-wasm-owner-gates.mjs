import { checkCapabilities } from "./liquid-object-wasm-capability-gates.mjs";
import assert from "node:assert/strict";

export function checkLiquidOwnerWasm(module) {
	for (const name of [
		"liquidObjectTransportPolicyJson",
		"LiquidObjectTransportOwner",
		"evaluateLiquidObjectFrameJson",
		"resolveProgrammaticFrameJson",
	])
		assert.equal(typeof module[name], "function", name);
	const policyJson = module.liquidObjectTransportPolicyJson(),
		policy = JSON.parse(policyJson);
	assert.equal(policy.version, 1);
	assert(
		Object.entries(policy).every(
			([key, value]) =>
				key === "version" || (Number.isSafeInteger(value) && value > 0),
		),
	);
	const frame = {
		sessionId: "actual-private-wasm-owner",
		index: 3,
		time: 1.25,
		seed: 17,
	};
	const owner = new module.LiquidObjectTransportOwner(JSON.stringify(frame));
	const replies = [];
	const command = (value) => {
		const result = JSON.parse(owner.command(JSON.stringify(value)));
		replies.push(result);
		return result;
	};
	try {
		assert.equal(command({ operation: "open", frame }).ok, true);
		const identity = { frame, requestId: 1 };
		const requestJson = JSON.stringify({
			version: 1,
			params: { version: 1 },
			positions: [-1, 0, 0, 1, 0, 0, 0, 1, 0],
			time: frame.time,
			seed: frame.seed,
		});
		const envelope = JSON.stringify({
			version: 1,
			identity,
			payloadJson: requestJson,
		});
		const accepted = command({
			operation: "reserve",
			identity,
			meshId: 1,
			vertices: 3,
			requestJsonBytes: Buffer.byteLength(requestJson),
			requestEnvelopeBytes: Buffer.byteLength(envelope),
		});
		assert.equal(accepted.ok, true);
		assert.equal(accepted.pending, true);
		const payloadJson = module.evaluateLiquidObjectFrameJson(requestJson);
		const result = JSON.parse(payloadJson);
		assert.equal(result.ok, true);
		assert.equal(result.frame.positions.length, 9);
		assert(result.frame.positions.every(Number.isFinite));
		const response = JSON.stringify({ version: 1, identity, payloadJson });
		const settled = command({
			operation: "settle",
			identity,
			responseJsonBytes: Buffer.byteLength(payloadJson),
			responseEnvelopeBytes: Buffer.byteLength(response),
		});
		assert.equal(settled.ok, true);
		assert.equal(settled.pending, false);
		assert.equal(settled.totals.requests, 1);
		assert.equal(command({ operation: "close", frame }).ok, true);
		const failed = command({ operation: "open", frame });
		assert.equal(failed.ok, false);
		const replay = command({ operation: "open", frame });
		assert.deepEqual(replay.error, failed.error);
		assert.deepEqual(replay.totals, failed.totals);
	} finally {
		owner.free();
	}
	const oversizeOwner = new module.LiquidObjectTransportOwner(
		JSON.stringify(frame),
	);
	try {
		let rejected = false;
		try {
			oversizeOwner.command(" ".repeat(policy.maxControlJsonBytes + 1));
		} catch {
			rejected = true;
		}
		assert(rejected, "actual JS-to-Rust pre-copy bound must reject");
		assert.equal(
			JSON.parse(
				oversizeOwner.command(JSON.stringify({ operation: "open", frame })),
			).ok,
			false,
		);
	} finally {
		oversizeOwner.free();
	}
	return {
		ok: true,
		policyJson,
		policy,
		replies,
		preCopyBoundTerminal: true,
		capabilities: checkCapabilities(module),
	};
}
