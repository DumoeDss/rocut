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
import { exerciseHeadlessRuntimeSensitivity } from "../../../../../script/fixtures/c7-headless-runtime-sensitivity-control";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
	const buildMarker = process.env.OPENCUT_C7_BUILD_MARKER ?? "development";
	const entry = "apps/web/src/app/c7-headless/route.ts";
	const runtimeProbe = installHeadlessRuntimeProbe({
		host: "next",
		environment: "server",
		buildMarker,
		entry,
	});
	runtimeProbe.markSubjectLoadStarted();
	const sensitivityControl = process.env.OPENCUT_C7_REACT_CONTROL === "1";
	const proofControl = await runHeadlessProofControl();
	let result: HeadlessSemanticResult;
	try {
		const { runHeadlessSemanticFixture } =
			await import("@opencut/editor-classic/evidence/headless-semantic-fixture");
		result = await runHeadlessSemanticFixture({
			host: "next",
			buildMarker,
			acceptedHead: process.env.OPENCUT_C7_ACCEPTED_HEAD ?? "development",
			acceptedTree: process.env.OPENCUT_C7_ACCEPTED_TREE ?? "development",
			entry,
			runtimeProbe,
			runtimeSensitivityControl: sensitivityControl
				? exerciseHeadlessRuntimeSensitivity
				: undefined,
		});
	} finally {
		runtimeProbe.finish();
		await proofControl.dispose();
	}
	return Response.json({
		result,
		proofControl: proofControl.identity,
	});
}
