import type {
	MvFlamePlan,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import type { ImagePreprocessOwner } from "../../packages/editor-classic/src/services/renderer/programmatic/image-preprocess-owner";
import { check, pixels } from "./mv-afterimage-capture";
import { controlledFlameReplay } from "./mv-flame-controlled-replay";

export async function captureFlame({
	source,
	resources,
	index,
	imagePreprocessOwner,
	control,
}: {
	source: ProgrammaticSource;
	resources: readonly ResolvedProgrammaticResource[];
	index: number;
	imagePreprocessOwner?: ImagePreprocessOwner;
	control?: { mutate?: (data: MvFlamePlan) => void };
}) {
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: source.durationFrames * 2000,
		trimStart: 0,
		timelineTime: 120000 + index * 2000,
	});
	check(frame?.index === index, "Flame source frame grid mismatch");
	const request = { source, frame, resources };
	const bitmap = control
		? await controlledFlameReplay({
				...request,
				mutate: (plan) => {
					check(plan.root.kind === "flame", "Expected Flame native plan");
					control.mutate?.(plan.root.data);
				},
			})
		: await renderProgrammaticCanvas({ ...request, imagePreprocessOwner });
	try {
		return pixels(bitmap, source.width, source.height);
	} finally {
		bitmap.close();
	}
}
