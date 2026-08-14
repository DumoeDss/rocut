import { runHeadlessProofControl } from "@opencut/editor-classic/evidence/headless";
import { installHeadlessRuntimeProbe } from "@opencut/editor-classic/evidence/headless";
// Must stay `import type`, never a value import: `runHeadlessSemanticFixture`
// is loaded dynamically from this exact same specifier below. `1770d9b0` fixed
// a real bug where Rollup/Vite folded a specifier reachable through both a
// static and a dynamic import into this entry's own chunk, producing a stray
// `modulepreload` link the neutral-arm MutationObserver flagged as a false
// positive. Today TypeScript erases this line before either bundler ever
// sees it, so no static edge to this specifier exists to fold — but that
// safety is contingent on the keyword, not the shape of the code. Converting
// this to a value import (or re-exporting `HeadlessSemanticResult` as a
// value) reintroduces the exact specifier collision `1770d9b0` fixed.
import type { HeadlessSemanticResult } from "@opencut/editor-classic/evidence/headless-semantic-fixture";
import { exerciseHeadlessRuntimeSensitivity } from "../../../script/fixtures/c7-headless-runtime-sensitivity-control";

declare const __OPENCUT_C7_BUILD_MARKER__: string;
declare const __OPENCUT_C7_ACCEPTED_HEAD__: string;
declare const __OPENCUT_C7_ACCEPTED_TREE__: string;
declare const __OPENCUT_C7_REACT_CONTROL__: boolean;

declare global {
	var __OPENCUT_C7_HEADLESS_RESULT__:
		| {
				result: HeadlessSemanticResult;
				proofControl: string;
		  }
		| undefined;
}

const entry = "apps/vite-example/src/headless-entry.ts";
document.documentElement.dataset.c7HeadlessStage = "entry-started";
const runtimeProbe = installHeadlessRuntimeProbe({
	host: "vite",
	environment: "browser",
	buildMarker: __OPENCUT_C7_BUILD_MARKER__,
	entry,
});
runtimeProbe.markSubjectLoadStarted();
document.documentElement.dataset.c7HeadlessStage = "proof-control-started";
const proofControl = await runHeadlessProofControl();
document.documentElement.dataset.c7HeadlessStage = "proof-control-completed";
let result: HeadlessSemanticResult;
try {
	const { runHeadlessSemanticFixture } =
		await import("@opencut/editor-classic/evidence/headless-semantic-fixture");
	document.documentElement.dataset.c7HeadlessStage = "semantic-fixture-started";
	result = await runHeadlessSemanticFixture({
		host: "vite",
		buildMarker: __OPENCUT_C7_BUILD_MARKER__,
		acceptedHead: __OPENCUT_C7_ACCEPTED_HEAD__,
		acceptedTree: __OPENCUT_C7_ACCEPTED_TREE__,
		entry,
		runtimeProbe,
		runtimeSensitivityControl: __OPENCUT_C7_REACT_CONTROL__
			? exerciseHeadlessRuntimeSensitivity
			: undefined,
	});
	document.documentElement.dataset.c7HeadlessStage =
		"semantic-fixture-completed";
} finally {
	runtimeProbe.finish();
	document.documentElement.dataset.c7HeadlessStage = "probe-finished";
	await proofControl.dispose();
}
globalThis.__OPENCUT_C7_HEADLESS_RESULT__ = {
	result,
	proofControl: proofControl.identity,
};
const output = document.getElementById("headless-result");
if (!output) throw new Error("C7 headless result element is absent");
output.textContent = JSON.stringify(result);
document.documentElement.dataset.c7Headless = "complete";
