import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { MvConvergePlan } from "../../packages/editor-contracts/src/mv-converge-plan";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { check, pixels } from "./mv-afterimage-capture";
export { check, pixels, difference } from "./mv-afterimage-capture";

export async function captureConverge(
	source: ProgrammaticSource,
	index: number,
	trim = 0,
	mutate?: (plan: MvConvergePlan) => void,
) {
	const step =
		(120000 * source.frameRate.denominator) / source.frameRate.numerator;
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: (source.durationFrames - trim) * step,
		trimStart: trim * step,
		timelineTime: 120000 + (index - trim) * step,
	});
	check(frame, "Missing converge frame");
	if (mutate) {
		check(
			frame.recipePlan?.root.kind === "converge",
			"Unexpected converge raster plan",
		);
		mutate(frame.recipePlan.root.data);
	}
	const bitmap = await renderProgrammaticCanvas({ source, frame });
	try {
		return pixels(bitmap, source.width, source.height);
	} finally {
		bitmap.close();
	}
}
