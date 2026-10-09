import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import type {
	createTitleRiffReference,
	TitleRiffArcObserver,
} from "./mv-title-riff-reference-browser";
import type { TitleRiffReferenceFrame } from "./mv-title-riff-reference-contract";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { controlledNativeReplay } from "./mv-native-controlled-replay";
import { check, pixels } from "./mv-afterimage-capture";

export async function captureTitleRiff(
	source: ProgrammaticSource,
	allResources: readonly ResolvedProgrammaticResource[],
	index: number,
	options: {
		controlled?: boolean;
		mutate?: (data: MvEmberPlan) => void;
		commandBatchSize?: 1 | 64 | 4096;
	} = {},
) {
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: source.durationFrames * 2000,
		trimStart: 0,
		timelineTime: 120000 + index * 2000,
	});
	check(frame?.index === index, "Native titleRiff frame grid mismatch");
	const resources = (source.resources ?? []).map((declared) => {
		const found = allResources.find(
			({ resource }) => resource.id === declared.id,
		);
		check(found, `Missing titleRiff fixture attachment: ${declared.id}`);
		return found;
	});
	const request = { source, frame, resources };
	const bitmap =
		options.controlled || options.mutate || options.commandBatchSize
			? await controlledNativeReplay({
					...request,
					commandBatchSize: options.commandBatchSize,
					mutate: (plan) => {
						check(
							plan.root.kind === "titleRiff",
							"Expected native titleRiff root for controlled replay",
						);
						options.mutate?.(plan.root.data);
					},
				})
			: await renderProgrammaticCanvas(request);
	try {
		return pixels(bitmap, source.width, source.height);
	} finally {
		bitmap.close();
	}
}

export async function originalTitleRiffPixels(
	oracle: Awaited<ReturnType<typeof createTitleRiffReference>>,
	frame: TitleRiffReferenceFrame,
	observe?: (
		ctx: CanvasRenderingContext2D,
		text: string,
		x: number,
		y: number,
	) => void,
	observeArc?: TitleRiffArcObserver,
) {
	const result = await oracle.render(frame, observe, observeArc);
	try {
		return {
			pixels: pixels(result.bitmap, 1920, 1080),
			provenance: result.provenance,
		};
	} finally {
		result.bitmap.close();
		result.canvas.width = result.canvas.height = 1;
	}
}
