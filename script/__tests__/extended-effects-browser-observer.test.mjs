import assert from "node:assert/strict";
import test from "node:test";
import { installExtendedEffectsBrowserPins } from "../fixtures/extended-effects-browser-observer.mjs";
import { installGlassWasmObserver } from "../fixtures/glass-current-baseline-observer.mjs";

const expectedSha256 = "a".repeat(64);
function fixture({ launchError, bindingError, closeError } = {}) {
	const events = [],
		receipts = [];
	let binding;
	const context = {
		browser: () => ({ version: () => "test-only-version" }),
		async exposeBinding(name, callback) {
			events.push(["binding", name]);
			binding = callback;
			if (bindingError) throw bindingError;
		},
		async addInitScript(script) {
			events.push(["init", script]);
		},
		async close(...args) {
			events.push(["close", args]);
			if (closeError) throw closeError;
		},
	};
	const chromium = {
		async launchPersistentContext(...args) {
			events.push(["launch", args]);
			if (launchError) throw launchError;
			return context;
		},
	};
	const report = installExtendedEffectsBrowserPins(chromium, {
		expectedSha256,
		writeReceipt: async (value) => receipts.push(structuredClone(value)),
	});
	const emit = (entry) => binding({}, entry);
	return { chromium, context, events, receipts, report, emit };
}
function authority(emit) {
	emit({ kind: "served", sha256: expectedSha256, bytes: 16, status: 200 });
	emit({ kind: "loaded", sha256: expectedSha256, bytes: 16, success: true });
}
test("CPU plumbing installs binding/init before returning context, preserves arguments and close", async () => {
	const f = fixture(),
		options = {
			executablePath: "pinned",
			args: ["original-only"],
			timeout: 30000,
		};
	const returned = await f.chromium.launchPersistentContext(
		"private-profile",
		options,
	);
	assert.equal(returned, f.context);
	assert.deepEqual(f.events[0], ["launch", ["private-profile", options]]);
	assert.deepEqual(f.events[1], ["binding", "__rocutGlassWasmPin"]);
	assert.deepEqual(f.events[2], ["init", installGlassWasmObserver]);
	assert.deepEqual(f.receipts, []);
	authority(f.emit);
	await returned.close({ reason: "original close" });
	assert.deepEqual(f.events[3], ["close", [{ reason: "original close" }]]);
	assert.equal(f.receipts.length, 1);
	assert.equal(f.receipts[0].ok, true);
	assert.equal(f.receipts[0].launches, 1);
	assert.equal(f.receipts[0].identity.loadedAuthority, true);
});
test("empty, unknown-module and served-only observations never pass", async () => {
	for (const populate of [
		() => {},
		(emit) => emit({ kind: "loaded", success: true, unknownModuleBytes: true }),
		(emit) =>
			emit({ kind: "served", sha256: expectedSha256, bytes: 16, status: 200 }),
	]) {
		const f = fixture();
		const context = await f.chromium.launchPersistentContext("profile", {});
		populate(f.emit);
		await context.close();
		assert.equal(f.receipts[0].ok, false);
		assert.equal(typeof f.receipts[0].failure, "string");
	}
});
test("observer errors and wrong/mismatched served bytes reject the witness", async () => {
	for (const populate of [
		(emit) => {
			authority(emit);
			emit({ kind: "error", message: "hash failure" });
		},
		(emit) => {
			authority(emit);
			emit({ kind: "unexpected" });
		},
		(emit) => {
			emit({ kind: "served", sha256: expectedSha256, bytes: 17, status: 200 });
			emit({
				kind: "loaded",
				sha256: expectedSha256,
				bytes: 16,
				success: true,
			});
		},
		(emit) => {
			emit({ kind: "served", sha256: "b".repeat(64), bytes: 16, status: 200 });
			emit({
				kind: "loaded",
				sha256: "b".repeat(64),
				bytes: 16,
				success: true,
			});
		},
	]) {
		const f = fixture();
		await f.chromium.launchPersistentContext("profile", {});
		populate(f.emit);
		await f.context.close();
		assert.equal(f.receipts[0].ok, false);
	}
});
test("launch failure retains failed receipt and original rejection", async () => {
	const error = new Error("native launch failed"),
		f = fixture({ launchError: error });
	await assert.rejects(
		f.chromium.launchPersistentContext("profile", {}),
		(value) => value === error,
	);
	assert.equal(f.receipts.length, 1);
	assert.equal(f.receipts[0].ok, false);
	assert.match(f.receipts[0].failure, /native launch failed/);
});
test("binding bootstrap failure closes owned context and retains failure", async () => {
	const error = new Error("binding failed"),
		f = fixture({ bindingError: error });
	await assert.rejects(
		f.chromium.launchPersistentContext("profile", {}),
		(value) => value === error,
	);
	assert.equal(f.events.filter(([kind]) => kind === "close").length, 1);
	assert.equal(f.receipts.length, 1);
	assert.equal(f.receipts[0].ok, false);
});
test("native close rejection remains failure even when authority is present", async () => {
	const error = new Error("native close failed"),
		f = fixture({ closeError: error });
	await f.chromium.launchPersistentContext("profile", {});
	authority(f.emit);
	await assert.rejects(f.context.close(), (value) => value === error);
	assert.equal(f.receipts.length, 1);
	assert.equal(f.receipts[0].ok, false);
	assert.match(f.receipts[0].failure, /native close failed/);
});
test("a second persistent launch is rejected without launching a hidden browser", async () => {
	const f = fixture();
	await f.chromium.launchPersistentContext("profile", {});
	await assert.rejects(
		f.chromium.launchPersistentContext("other", {}),
		/exactly one/,
	);
	assert.equal(f.events.filter(([kind]) => kind === "launch").length, 1);
	assert.equal(f.receipts[0].ok, false);
	assert.equal(f.receipts[0].launches, 2);
});
