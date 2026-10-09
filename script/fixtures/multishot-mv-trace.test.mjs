import assert from "node:assert/strict";
import test from "node:test";
import { traceAudioCollector } from "./multishot-mv-trace.mjs";

test("trace preserves calls, receiver, ordering, parameters and returned identity", async () => {
	const calls = [],
		events = [],
		response = { value: "actual native result" };
	const payload = { expression: "SECRET_EXPRESSION", asset: "SECRET_ASSET" };
	const options = {
		frame: { index: 42, time: 1.68 },
		signal: new AbortController().signal,
	};
	const browser = {
		async send(...args) {
			assert.equal(this, browser);
			calls.push(args);
			return response;
		},
	};
	const collect = async (observed, received) => {
		assert.equal(received, options);
		const first = await observed.send(
			"Target.createTarget",
			payload,
			"session-a",
		);
		assert.equal(first, response);
		return observed.send("Runtime.evaluate", payload, "session-b");
	};
	assert.equal(
		await traceAudioCollector(collect, (e) => events.push(e))(browser, options),
		response,
	);
	assert.deepEqual(calls, [
		["Target.createTarget", payload, "session-a"],
		["Runtime.evaluate", payload, "session-b"],
	]);
	assert.deepEqual(
		events.map((e) => e.event),
		[
			"frame-start",
			"cdp-start",
			"cdp-end",
			"cdp-start",
			"cdp-end",
			"frame-end",
		],
	);
	assert.ok(events.every((e) => e.frameIndex === 42 && e.sourceTime === 1.68));
	assert.ok(!JSON.stringify(events).includes("SECRET"));
});

test("trace preserves original rejection and redacts arbitrary error/abort text", async () => {
	const controller = new AbortController(),
		events = [];
	const failure = new Error("SECRET_NATIVE_ERROR");
	const browser = {
		async send() {
			controller.abort(new Error("SECRET_ABORT"));
			throw failure;
		},
	};
	const collect = async (observed) =>
		observed.send("Runtime.evaluate", { expression: "SECRET_EXPRESSION" });
	await assert.rejects(
		traceAudioCollector(collect, (e) => events.push(e))(browser, {
			frame: { index: 7 },
			signal: controller.signal,
		}),
		(error) => error === failure,
	);
	assert.deepEqual(
		events.map((e) => e.event),
		["frame-start", "cdp-start", "cdp-error", "frame-error"],
	);
	assert.equal(events.at(-1).aborted, true);
	assert.equal(events.at(-1).error.messageSha256.length, 64);
	assert.equal(events.at(-1).abortReason.messageSha256.length, 64);
	assert.ok(!JSON.stringify(events).includes("SECRET"));
});

test("logging failures cannot change genuine collector success or failure", async () => {
	const options = { frame: {}, signal: new AbortController().signal };
	const result = {},
		failure = new Error("native failure");
	const record = () => {
		throw Error("trace disk failure");
	};
	assert.equal(
		await traceAudioCollector(async () => result, record)({}, options),
		result,
	);
	await assert.rejects(
		traceAudioCollector(async () => {
			throw failure;
		}, record)({}, options),
		(error) => error === failure,
	);
});

test("uninspectable error metadata cannot replace the genuine failure", async () => {
	const failure = new Error();
	Object.defineProperty(failure, "message", {
		get() {
			throw Error("metadata getter failed");
		},
	});
	const browser = {
		async send() {
			throw failure;
		},
	};
	const traced = traceAudioCollector(
		async (observed) => observed.send("Runtime.evaluate"),
		() => {},
	);
	await assert.rejects(
		traced(browser, { frame: {}, signal: new AbortController().signal }),
		(error) => error === failure,
	);
});
