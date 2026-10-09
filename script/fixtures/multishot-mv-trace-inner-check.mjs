import assert from "node:assert/strict";
import vm from "node:vm";
import {
	htmlAudioAnalysisExpression,
	htmlCaptureExpression,
} from "../../apps/cli/src/programmatic/html-document.ts";
import { instrumentAudioExpression } from "./multishot-mv-trace-inner.mjs";

const authored =
	"<div data-note='SECRET_FIXTURE_MARKER'>unchanged authored HTML $& $' $` $$</div>";
const analysis = {
	engine: "hyperframes",
	hyperframesGraph: false,
	sources: [],
	limits: {},
};
const original = htmlAudioAnalysisExpression(
	authored,
	{ index: 80, time: 3.2 },
	[],
	analysis,
);
const observed = instrumentAudioExpression(original);
const immediateSuccess = "      if (event.data.ok) resolve(event.data.assets);";
const legacySuccess =
	"      if (event.data.ok) requestAnimationFrame(() => requestAnimationFrame(() => resolve(event.data.assets)));";
assert.ok(original.includes(immediateSuccess));
const legacy = original.replace(immediateSuccess, () => legacySuccess);
const observedLegacy = instrumentAudioExpression(legacy);
const srcdoc = (expression) =>
	JSON.parse(
		expression
			.split("\n    iframe.srcdoc = ")[1]
			.split(";\n    document.body.appendChild(iframe);")[0],
	);
const originalDocument = srcdoc(original),
	observedDocument = srcdoc(observed);
assert.equal(
	originalDocument.slice(originalDocument.indexOf("</script>") + 9),
	authored,
);
assert.equal(
	observedDocument.slice(observedDocument.indexOf("</script>") + 9),
	authored,
);
assert.equal(
	(original.match(/\bawait\b/g) ?? []).length,
	(observed.match(/\bawait\b/g) ?? []).length,
);
assert.equal(
	(original.match(/requestAnimationFrame/g) ?? []).length,
	(observed.match(/requestAnimationFrame/g) ?? []).length,
);
new vm.Script(observed);
new vm.Script(observedLegacy);
assert.equal(
	(legacy.match(/requestAnimationFrame/g) ?? []).length,
	(observedLegacy.match(/requestAnimationFrame/g) ?? []).length,
);
assert.equal(
	srcdoc(observedLegacy).slice(srcdoc(observedLegacy).indexOf("</script>") + 9),
	authored,
);
new vm.Script(
	observedDocument.slice(
		observedDocument.indexOf("<script>") + 8,
		observedDocument.indexOf("</script>"),
	),
);
assert.throws(
	() =>
		instrumentAudioExpression(
			original.replace("await author?.ready;", "await changed.ready;"),
		),
	/shape changed/,
);
assert.throws(
	() =>
		instrumentAudioExpression(
			htmlCaptureExpression(authored, { index: 80, time: 3.2 }),
		),
	/shape changed/,
);

function evaluate(expression) {
	const callbacks = [],
		listeners = [],
		phases = [];
	const iframe = { contentWindow: {}, style: {} };
	const context = vm.createContext({
		document: {
			documentElement: { style: {} },
			body: { style: {}, appendChild() {} },
			createElement: () => iframe,
		},
		window: {},
		performance: { now: () => 1 },
		console: { debug: (message) => phases.push(message) },
		addEventListener: (name, listener) => {
			if (name === "message") listeners.push(listener);
		},
		requestAnimationFrame: (callback) => callbacks.push(callback),
	});
	const promise = new vm.Script(expression).runInContext(context);
	return {
		promise,
		callbacks,
		phases,
		send: (data) =>
			listeners.forEach((listener) =>
				listener({ source: iframe.contentWindow, data }),
			),
	};
}
for (const { expression, waitRaf } of [
	{ expression: original, waitRaf: false },
	{ expression: observed, waitRaf: false },
	{ expression: legacy, waitRaf: true },
	{ expression: observedLegacy, waitRaf: true },
]) {
	const run = evaluate(expression),
		assets = { untouched: true };
	let settled = false;
	void run.promise.then(() => {
		settled = true;
	});
	run.send({
		tag: "rocut-multishot-audio-phase",
		phase: "snapshot-post-before",
		clock: 1,
	});
	assert.equal(run.callbacks.length, 0);
	run.send({ tag: "rocut-html-frame", ok: true, assets });
	if (waitRaf) {
		await Promise.resolve();
		assert.equal(settled, false);
		assert.equal(run.callbacks.length, 1);
		run.callbacks.shift()();
		await Promise.resolve();
		assert.equal(settled, false);
		assert.equal(run.callbacks.length, 1);
		run.callbacks.shift()();
	} else {
		assert.equal(run.callbacks.length, 0);
	}
	assert.equal(await run.promise, assets);
	if (expression === observed) {
		assert.ok(run.phases.some((phase) => phase.includes("outer-resolved")));
		assert.ok(run.phases.every((phase) => !phase.includes("outer-raf-")));
	}
	const failed = evaluate(expression);
	failed.send({ tag: "rocut-html-frame", error: "original native error" });
	await assert.rejects(failed.promise, /original native error/);
}
console.log(
	JSON.stringify({
		passed: true,
		authoredBytesUnchanged: true,
		awaitAndRafCountsUnchanged: true,
		twoRafSettlementPreserved: true,
		immediateSettlementPreserved: true,
		rejectionPreserved: true,
		browserLaunched: false,
	}),
);
