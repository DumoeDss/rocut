import { test } from "node:test";
import assert from "node:assert/strict";
import { createJzNativeOwner } from "./mv-jz-owner-api";

test("JZ rejects stale WASM API and frees its allocated native owner", () => {
	const calls: string[] = [];
	class StaleOwner {
		constructor() { calls.push("allocate"); }
		dispose() { calls.push("dispose"); }
		free() { calls.push("free"); }
	}
	assert.throws(() => createJzNativeOwner(StaleOwner), /rebuild/);
	assert.deepEqual(calls, ["allocate", "dispose", "free"]);
	class BrokenDispose extends StaleOwner {
		dispose() { calls.push("broken-dispose"); throw Error("old ABI"); }
	}
	assert.throws(() => createJzNativeOwner(BrokenDispose), /rebuild/);
	assert.deepEqual(calls.slice(-3), ["allocate", "broken-dispose", "free"]);
});

test("JZ valid owner survives factory admission and a subsequent rebuilt owner is fresh", () => {
	const calls: string[] = [];
	class CurrentOwner {
		prepare() { return 1; } preparedJson() { return "{}"; } frame() { return "{}"; }
		checkText() {} finishFrame() {} release() {}
		dispose() { calls.push("dispose"); } free() { calls.push("free"); }
	}
	const first = createJzNativeOwner(CurrentOwner), second = createJzNativeOwner(CurrentOwner);
	assert.notEqual(first, second); assert.deepEqual(calls, []);
	first.dispose(); first.free();
	assert.deepEqual(calls, ["dispose", "free"]);
	assert.equal(second.prepare("{}", new Uint8Array()), 1);
	assert.throws(() => createJzNativeOwner(undefined), /rebuilt/);
});
