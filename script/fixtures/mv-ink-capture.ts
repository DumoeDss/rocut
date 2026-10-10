import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { MvInkPlan } from "../../packages/editor-contracts/src/mv-ink";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { check, pixels } from "./mv-afterimage-capture";
import { controlledInkReplay } from "./mv-ink-controlled-replay";
export async function captureInk({
	source,
	resources,
	index,
	control,
}: {
	source: ProgrammaticSource;
	resources: readonly ResolvedProgrammaticResource[];
	index: number;
	control?: { mutate?: (plan: MvInkPlan) => void };
}) {
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: source.durationFrames * 2000,
		trimStart: 0,
		timelineTime: 120000 + index * 2000,
	});
	check(frame?.index === index, "Ink source grid mismatch");
	const request = { source, frame, resources };
	const bitmap = control
		? await controlledInkReplay({
				...request,
				mutate: (plan) => {
					check(plan.root.kind === "ink", "Expected Ink native plan");
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
