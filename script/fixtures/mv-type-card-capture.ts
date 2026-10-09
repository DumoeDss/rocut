import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { MvTypeCardPlan } from "../../packages/editor-contracts/src/mv-type-card-plan";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { resolveMvResourceFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-resource-frame";
export { check, difference, pixels } from "./mv-afterimage-capture";
import { check, pixels } from "./mv-afterimage-capture";

export async function capture(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
	trim = 0,
	mutate?: (plan: MvTypeCardPlan) => void,
	signal?: AbortSignal,
) {
	const step =
		(120000 * source.frameRate.denominator) / source.frameRate.numerator;
	let frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: (source.durationFrames - trim) * step,
		trimStart: trim * step,
		timelineTime: 120000 + (index - trim) * step,
	});
	check(frame, "Missing typeCard frame");
	if (mutate) {
		frame = await resolveMvResourceFrame({ source, resources, frame, signal });
		const root = frame.recipePlan?.root;
		check(root?.kind === "typeCard", "Unexpected typeCard root");
		mutate(root.data);
	}
	const bitmap = await renderProgrammaticCanvas({
		source,
		resources,
		frame,
		signal,
	});
	try {
		return pixels(bitmap, source.width, source.height);
	} finally {
		bitmap.close();
	}
}

export async function verifyFontResolution(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
) {
	const input = {
		source,
		clipStart: 0,
		clipDuration: 480000,
		trimStart: 0,
		timelineTime: 60000,
	};
	const frame = resolveProgrammaticFrame(input);
	check(
		frame?.fontMetricRequests?.length,
		"Quiet did not request real font measurement",
	);
	check(!frame.recipePlan, "Quiet evaluated without supplied font metrics");
	const resolved = await resolveMvResourceFrame({ source, resources, frame });
	check(
		resolved.recipePlan?.root.kind === "typeCard" &&
			!resolved.fontMetricRequests?.length,
		"Measured quiet did not return final Rust plan",
	);
	return {
		requests: frame.fontMetricRequests.map((request) => ({
			font: request.resource.id,
			glyphs: request.glyphs,
		})),
		completed: true,
	};
}
