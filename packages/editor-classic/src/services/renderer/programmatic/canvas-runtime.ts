import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { ProgrammaticFrame } from "./frame";
import { runProgrammaticSandbox } from "./sandbox-runtime";
import { resolveMvResourceFrame } from "./mv-resource-frame";
import { resolveCanvasSequenceImages } from "./image-sequence-resources";
import { prepareMvNativeRasterTicket } from "./mv-native-admission";
import { runMvNativeRaster } from "./mv-native-runtime";

export interface ProgrammaticRenderRequest {
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	signal?: AbortSignal;
	resources?: readonly ResolvedProgrammaticResource[];
	provider?: ProgrammaticFrameProvider;
}

/** One isolated execution per frame: random seek cannot inherit earlier state.
 * The caller owns the returned bitmap and MUST close it after copying/uploading.
 */
export async function renderProgrammaticCanvas({
	source,
	frame,
	signal,
	resources = [],
	provider,
}: ProgrammaticRenderRequest): Promise<ImageBitmap> {
	// Native Ember/titleRiff/kanjiSlam/thread/fall need HTMLCanvas clip coverage, including internal
	// surfaces. Keep authored JavaScript on the separate, terminable Worker.
	// A mixed recipe uses one backend for all its frames to avoid switching
	// raster semantics as references/transitions activate different children.
	if (
		source.recipe?.nodes.some(
			(node) =>
				node.scene.kind === "ember" ||
				node.scene.kind === "titleRiff" ||
				node.scene.kind === "kanjiSlam" ||
				node.scene.kind === "thread" ||
				node.scene.kind === "fall",
		)
	) {
		const ticket = await prepareMvNativeRasterTicket({
			source,
			frame,
			resources,
			provider,
			signal,
		});
		return runMvNativeRaster({ ticket, signal });
	}
	frame = await resolveMvResourceFrame({ source, frame, resources, signal });
	const sequenceImages = await resolveCanvasSequenceImages({
		frame,
		provider,
		signal: signal ?? new AbortController().signal,
	});
	return runProgrammaticSandbox({
		source,
		frame,
		resources,
		sequenceImages,
		operation: "render",
		signal,
	});
}
