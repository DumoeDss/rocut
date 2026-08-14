import { runHeadlessProofControl } from "@opencut/editor-classic/evidence";
import { installHeadlessRuntimeProbe } from "@opencut/editor-classic/evidence";
import type { HeadlessSemanticResult } from "@opencut/editor-classic/evidence";
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
		await import("@opencut/editor-classic/evidence");
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
