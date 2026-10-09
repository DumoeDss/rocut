import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import type { createKanjiSlamReference } from "./mv-kanji-slam-reference-browser";
import type { KanjiSlamFrame } from "./mv-kanji-slam-reference-contract";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { controlledNativeReplay } from "./mv-native-controlled-replay";
import { check, pixels } from "./mv-afterimage-capture";

export async function captureKanjiSlam(
	source: ProgrammaticSource,
	allResources: readonly ResolvedProgrammaticResource[],
	index: number,
	options: { controlled?: boolean; mutate?: (data: MvEmberPlan) => void } = {},
) {
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: source.durationFrames * 2000,
		trimStart: 0,
		timelineTime: 120000 + index * 2000,
	});
	check(frame?.index === index, "Native kanjiSlam frame grid mismatch");
	const resources = (source.resources ?? []).map((declared) => {
		const found = allResources.find(
			({ resource }) => resource.id === declared.id,
		);
		check(found, `Missing kanjiSlam fixture attachment: ${declared.id}`);
		return found;
	});
	const request = { source, frame, resources };
	const bitmap =
		options.controlled || options.mutate
			? await controlledNativeReplay({
					...request,
					mutate: (plan) => {
						check(
							plan.root.kind === "kanjiSlam",
							"Expected native kanjiSlam root for controlled replay",
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

export async function originalKanjiSlamPixels(
	oracle: Awaited<ReturnType<typeof createKanjiSlamReference>>,
	frame: KanjiSlamFrame,
	observe = false,
) {
	const result = await oracle.render(frame, observe);
	try {
		return {
			pixels: pixels(result.bitmap, 1920, 1080),
			provenance: result.provenance,
			textCalls: result.textCalls,
		};
	} finally {
		result.bitmap.close();
		result.canvas.width = result.canvas.height = 1;
	}
}
