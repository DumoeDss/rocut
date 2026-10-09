import assert from "node:assert/strict";
import test from "node:test";
import {
	fallProgressSnapshot,
	startFallProgress,
} from "./mv-fall-progress.mjs";

test("Fall progress returns bounded metadata without observation payloads", () => {
	globalThis.__fallProgress = {
		current: "x".repeat(1000),
		observations: { one: { pixels: [1, 2, 3] }, two: {} },
		violations: ["a", "b"],
	};
	try {
		assert.deepEqual(fallProgressSnapshot(), {
			current: "x".repeat(160),
			observations: 2,
			violations: 2,
			completed: false,
		});
	} finally {
		delete globalThis.__fallProgress;
	}
});

test("Fall progress is 30-second, single-flight and silent after stop", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"] });
	let resolve,
		calls = 0;
	const lines = [];
	const page = {
		evaluate: () => {
			calls++;
			return new Promise((r) => {
				resolve = r;
			});
		},
	};
	const stop = startFallProgress(page, (line) => lines.push(JSON.parse(line)));
	t.mock.timers.tick(29999);
	assert.equal(calls, 0);
	t.mock.timers.tick(1);
	assert.equal(calls, 1);
	t.mock.timers.tick(30000);
	assert.equal(calls, 1);
	resolve({
		current: "default/1",
		observations: 2,
		violations: 0,
		completed: false,
	});
	await Promise.resolve();
	assert.equal(lines.length, 1);
	assert.equal(lines[0].elapsedMs, 60000);
	t.mock.timers.tick(30000);
	assert.equal(calls, 2);
	stop();
	resolve({ current: "late" });
	await Promise.resolve();
	t.mock.timers.tick(60000);
	assert.equal(lines.length, 1);
	assert.equal(calls, 2);
});
