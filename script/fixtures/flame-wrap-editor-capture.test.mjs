import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { capture } from "./flame-wrap-editor-capture.mjs";
import { seek } from "./flame-wrap-editor-controls.mjs";
async function fixture(
	sample = {
		serial: 5,
		width: 1,
		height: 1,
		rgba: [40, 80, 120, 255],
		contextAttributes: { preserveDrawingBuffer: false },
	},
	minimumSerial = 0,
) {
	const artifacts = {
		root: await mkdtemp("C:/tmps/flame-wrap-boundary-cpu-"),
		width: 1,
		height: 1,
		clipId: "cpu-only",
		usePresentationObserver: true,
	};
	let forbiddenCopies = 0;
	const canvas = {
		width: 1,
		height: 1,
		getBoundingClientRect: () => ({ width: 1, height: 1 }),
	};
	const context = vm.createContext({
		document: {
			querySelectorAll: () => [canvas],
			createElement: () => {
				forbiddenCopies++;
				throw new Error("Idle fallback forbidden");
			},
		},
		getComputedStyle: () => ({ visibility: "visible", display: "block" }),
		btoa: (value) => Buffer.from(value, "binary").toString("base64"),
		__flameWrapPresentationMinSerial: minimumSerial,
		__flameWrapPresentationObserver: {
			read: () => sample,
			status: () => ({ serial: 5 }),
		},
	});
	const page = {
		evaluate: async (fn, args) => {
			context.args = args;
			return vm.runInContext(`(${fn.toString()})(args)`, context);
		},
	};
	return { artifacts, page, context, forbiddenCopies: () => forbiddenCopies };
}
// CPU/VM DOM observations only: not live browser, presentation or GPU evidence.
test("observer capture retains new actual sample and publication metadata without idle fallback", async () => {
	const f = await fixture();
	const result = await capture(f.page, f.artifacts, 20000, 1, "fresh", {
		timeoutMs: 2500,
	});
	assert.equal(result.captureScope, "production-presentation-boundary-copy");
	assert.equal(result.publicationSerial, 5);
	assert.equal(result.minimumSerial, 0);
	assert.equal(result.contextAttributes.preserveDrawingBuffer, false);
	assert(result.stableConsecutiveSamples >= 4);
	assert.equal(f.forbiddenCopies(), 0);
});
test("globally stale publication cannot satisfy stability before deadline", async () => {
	const f = await fixture(undefined, 5);
	await assert.rejects(
		capture(f.page, f.artifacts, 20000, 1, "stale", { timeoutMs: 350 }),
		(error) => {
			assert.match(error.message, /deadline exceeded/);
			assert(error.captureObservation.staleFrameSamples >= 3);
			assert.equal(error.captureObservation.lastStableConsecutiveSamples, 0);
			return true;
		},
	);
	assert.equal(f.forbiddenCopies(), 0);
});
test("missing/empty publications fail at deadline without idle or screenshot fallback", async () => {
	const f = await fixture(null);
	await assert.rejects(
		capture(f.page, f.artifacts, 20000, 1, "empty", { timeoutMs: 350 }),
		(error) => {
			assert.match(error.message, /deadline exceeded/);
			assert(error.captureObservation.emptyFrameSamples >= 3);
			return true;
		},
	);
	assert.equal(f.forbiddenCopies(), 0);
});
test("missing observer fails immediately, never falls back", async () => {
	const f = await fixture();
	delete f.context.__flameWrapPresentationObserver;
	await assert.rejects(
		capture(f.page, f.artifacts, 20000, 1, "absent", { timeoutMs: 350 }),
		/observer missing/,
	);
	assert.equal(f.forbiddenCopies(), 0);
});
test("seek freezes global publication serial before actual playhead UI actions", async () => {
	const f = await fixture(),
		calls = [];
	const originalEvaluate = f.page.evaluate;
	f.page.evaluate = async (...args) => {
		calls.push("freeze");
		return originalEvaluate(...args);
	};
	let value;
	f.page.getByRole = (_role, options) => ({
		click: async () => calls.push("click"),
		fill: async (next) => {
			value = next;
		},
		press: async () => {},
		innerText: async () => value,
	});
	await seek(f.page, 20000, { numerator: 24, denominator: 1 });
	assert.equal(f.context.__flameWrapPresentationMinSerial, 5);
	assert.deepEqual(calls.slice(0, 2), ["freeze", "click"]);
});
