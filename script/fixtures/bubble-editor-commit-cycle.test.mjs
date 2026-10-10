import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { beginBubbleEditorCommitObservation as begin, finishBubbleEditorCommitObservation as finish,
	isBubbleEditorCommitObservationComplete as complete, assertBubbleEditorCommitCycle as accepts } from "./bubble-editor-observe.mjs";
import { assertBubbleEditorBrowserErrors } from "../probe-bubble-editor.mjs";

function harness() {
	let busy = "false", observer;
	const fieldset = { disabled: false, isConnected: true, getAttribute: () => busy };
	const input = { closest: () => fieldset };
	const context = vm.createContext({ MutationObserver: class {
		constructor(callback) { this.callback = callback; this.records = []; observer = this; }
		observe() {} disconnect() {} takeRecords() { return this.records.splice(0); }
	} });
	const execute = (fn, args) => vm.runInContext(`(${fn.toString()})`, context)(...args);
	const locator = { filter: () => locator, evaluate: async (fn, arg) => execute(fn, [input, arg]) };
	const page = { getByRole: () => locator, evaluate: async (fn, arg) => {
		const value = execute(fn, [arg]); return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
	} };
	return { page, fieldset, change(value) { observer.records.push({ attributeName: "aria-busy", oldValue: busy });
		busy = value; fieldset.disabled = value === "true"; } };
}

test("each repeated rejection needs a new real DOM busy cycle; batched mutation delivery retains true", async () => {
	const h = harness();
	for (const attempt of ["a", "b", "c"]) {
		await begin(h.page, "point1Time", attempt);
		assert.equal(await complete(h.page, attempt), false);
		h.change("true"); h.change("false");
		assert.equal(await complete(h.page, attempt), true);
		accepts(await finish(h.page, attempt), attempt);
		await assert.rejects(finish(h.page, attempt), /Missing current/);
	}
});

test("old alert and fast React batch with no committed busy=true remain red", async () => {
	const h = harness(); await begin(h.page, "point1Time", "stale");
	assert.equal(await complete(h.page, "stale"), false);
	assert.throws(() => accepts({ attempt: "stale", initialBusy: "false", initialDisabled: false,
		connected: true, busyValues: ["false"], busy: "false", disabled: false }, "stale"));
	assert.throws(() => accepts(awaitFinishEquivalent(), "stale"));
	function awaitFinishEquivalent() { return { attempt: "stale", initialBusy: "false", initialDisabled: false,
		connected: true, busyValues: ["false", "false"], busy: "false", disabled: false }; }
	const cycle = await finish(h.page, "stale");
	assert.throws(() => accepts(cycle, "stale"));
	assert.throws(() => accepts({ ...cycle, attempt: "old" }, "stale"));
});

test("unfinished save, replaced fieldset and reusing an armed observer cannot pass", async () => {
	const h = harness(); await begin(h.page, "point1Time", "a");
	await assert.rejects(begin(h.page, "point1Time", "b"), /already armed/);
	h.change("true"); assert.equal(await complete(h.page, "a"), false);
	h.change("false"); h.fieldset.isConnected = false;
	assert.equal(await complete(h.page, "a"), false);
	assert.throws(() => accepts(awaitFinishEquivalent(), "a"));
	function awaitFinishEquivalent() { return { attempt: "a", initialBusy: "false", initialDisabled: false,
		connected: false, busyValues: ["false", "true", "false"], busy: "false", disabled: false }; }
	await finish(h.page, "a");
});

test("disabled DOM rejection requires no renderer console; every unknown console error remains fatal", () => {
	const item = { attempt: "disabled", boundary: "local-dom-commit-rejection", applyWrites: 0,
		commitCycle: { attempt: "disabled", initialBusy: "false", initialDisabled: false, connected: true,
			busyValues: ["false", "true", "false"], busy: "false", disabled: false },
		snapshotUnchanged: true, savedBytesUnchanged: true, draftVisible: true, nativeConsoleIndices: [] };
	const evidence = { errors: [], externalRequests: [], requestFailures: [], httpFailures: [], consoleErrors: [],
		localPointErrors: [], validatedRejections: [item] };
	assertBubbleEditorBrowserErrors(evidence);
	for (const message of ["BorrowMutError", "Failed to render preview frame: AbortError: Programmatic frame cancelled", "GPU panic"])
		assert.throws(() => assertBubbleEditorBrowserErrors({ ...evidence, consoleErrors: [message] }));
	for (const key of ["snapshotUnchanged", "savedBytesUnchanged", "draftVisible"])
		assert.throws(() => assertBubbleEditorBrowserErrors({ ...evidence, validatedRejections: [{ ...item, [key]: false }] }));
});
