import { runHeadlessProofControl } from "@/editor/session/headless-proof-control";
import { installHeadlessRuntimeProbe } from "@/editor/session/headless-runtime-probe";
import type { HeadlessSemanticResult } from "@/editor/session/headless-semantic-fixture";
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
			await import("@/editor/session/headless-semantic-fixture");
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
