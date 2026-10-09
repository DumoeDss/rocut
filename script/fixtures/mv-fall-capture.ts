import type {
	MvEmberPlan,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { controlledNativeReplay } from "./mv-native-controlled-replay";
import { check, pixels } from "./mv-afterimage-capture";

export async function captureFall(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
	control?: { mutate?: (data: MvEmberPlan) => void },
) {
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: source.durationFrames * 2000,
		trimStart: 0,
		timelineTime: 120000 + index * 2000,
	});
	check(frame?.index === index, "Fall source frame grid mismatch");
	const request = { source, frame, resources };
	const bitmap = control
		? await controlledNativeReplay({
				...request,
				mutate: (plan) => {
					check(plan.root.kind === "fall", "Expected Fall native plan");
					control.mutate?.(plan.root.data);
				},
			})
		: await renderProgrammaticCanvas(request);
	try {
		return pixels(bitmap, 1920, 1080);
	} finally {
		bitmap.close();
	}
}
