import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectHyperframesAudioSnapshot } from "../../apps/cli/src/programmatic/hyperframes-audio-analysis-frame.ts";

// No browser is launched. This checks that Bun's diagnostic preload really wraps
// the unchanged production collector and keeps its protocol order/result identity.
const calls = [],
	value = { marker: "genuine collector return" },
	controller = new AbortController();
const browser = {
	async send(method, _params, sessionId) {
		calls.push({ method, sessionId });
		if (method === "Target.createTarget") return { targetId: "private-target" };
		if (method === "Target.attachToTarget")
			return { sessionId: "private-session" };
		if (method === "Runtime.evaluate") return { result: { value } };
		return {};
	},
};
const actual = await collectHyperframesAudioSnapshot(browser, {
	width: 160,
	height: 90,
	code: "SECRET_AUTHORED_HTML",
	frame: { index: 42, time: 1.68 },
	resources: [],
	analysis: {
		engine: "hyperframes",
		hyperframesGraph: false,
		limits: {},
		sources: [],
	},
	signal: controller.signal,
});
assert.equal(actual, value);
assert.deepEqual(
	calls.map((item) => item.method),
	[
		"Target.createTarget",
		"Target.attachToTarget",
		"Network.enable",
		"Network.setBlockedURLs",
		"Page.enable",
		"Emulation.setDeviceMetricsOverride",
		"Runtime.enable",
		"Runtime.evaluate",
		"Target.closeTarget",
	],
);
assert.ok(
	calls.slice(2, -1).every((item) => item.sessionId === "private-session"),
);
const text = readFileSync(process.env.ROCUT_TEST_MULTISHOT_AUDIO_TRACE, "utf8");
const trace = text
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));
assert.equal(trace.length, 20);
assert.equal(trace[0].event, "frame-start");
assert.equal(trace.at(-1).event, "frame-end");
assert.ok(trace.every((item) => item.frameIndex === 42));
assert.ok(!text.includes("SECRET"));
console.log(
	JSON.stringify({
		passed: true,
		protocolCalls: calls.length,
		traceRecords: trace.length,
		browserLaunched: false,
	}),
);
