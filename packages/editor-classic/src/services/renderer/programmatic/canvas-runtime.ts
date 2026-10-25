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
import {
	ImagePreprocessOwner,
	type ImagePreprocessAccess,
} from "./image-preprocess-owner";
import { awaitImagePreprocessDeadline } from "./image-preprocess-deadline";
import type { ProgrammaticSandboxRealm } from "./sandbox-realm";

export interface ProgrammaticRenderRequest {
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	signal?: AbortSignal;
	resources?: readonly ResolvedProgrammaticResource[];
	provider?: ProgrammaticFrameProvider;
	imagePreprocessOwner?: ImagePreprocessAccess;
	sandboxRealm?: ProgrammaticSandboxRealm;
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
	imagePreprocessOwner,
	sandboxRealm,
}: ProgrammaticRenderRequest): Promise<ImageBitmap> {
	// Native MV scenes need HTMLCanvas clip coverage, including internal
	// surfaces. Keep authored JavaScript on the separate, terminable Worker.
	// A mixed recipe uses one backend for all its frames to avoid switching
	// raster semantics as references/transitions activate different children.
	if (
		source.recipe?.nodes.some(
			(node) =>
				node.scene.kind === "jz" ||
				node.scene.kind === "panelsNative" ||
				node.scene.kind === "freeze" ||
				node.scene.kind === "rewind" ||
				node.scene.kind === "melt" ||
				node.scene.kind === "burst" ||
				node.scene.kind === "illustNative" ||
				node.scene.kind === "night" ||
				node.scene.kind === "memories" ||
				node.scene.kind === "ember" ||
				node.scene.kind === "titleRiff" ||
				node.scene.kind === "kanjiSlam" ||
				node.scene.kind === "thread" ||
				node.scene.kind === "fall" ||
				node.scene.kind === "flame" ||
				node.scene.kind === "ink" ||
				node.scene.kind === "tunnel" ||
				node.scene.kind === "road" ||
				node.scene.kind === "heartShatter" ||
				node.scene.kind === "heartShatterBurn" ||
				node.scene.kind === "heartGather" ||
				node.scene.kind === "sunBloom" ||
				node.scene.kind === "skyShatter",
		)
	) {
		const deadline = new AbortController();
		const flame = source.recipe.nodes.some(
			(node) => node.scene.kind === "flame",
		);
		const ownerPreparation =
			flame ||
			source.recipe.nodes.some((node) =>
				[
					"jz",
					"night",
					"memories",
					"heartShatter",
					"heartShatterBurn",
					"heartGather",
					"sunBloom",
					"skyShatter",
				].includes(node.scene.kind),
			);
		const timer = ownerPreparation
			? setTimeout(
					() =>
						deadline.abort(
							Error("Native MV preparation timed out after 5000 ms"),
						),
					5000,
				)
			: undefined;
		const linked = ownerPreparation
			? AbortSignal.any([...(signal ? [signal] : []), deadline.signal])
			: signal;
		const ownsPreprocessor = flame && !imagePreprocessOwner;
		let releaseEncoded: (() => void) | undefined;
		let admissionPending: Promise<unknown> | undefined;
		try {
			if (flame) {
				imagePreprocessOwner ??= new ImagePreprocessOwner();
				releaseEncoded = imagePreprocessOwner.reserve(
					resources.reduce((sum, item) => sum + item.body.byteLength * 3, 0),
				);
			}
			const preparation = prepareMvNativeRasterTicket({
				source,
				frame,
				resources,
				provider,
				signal: linked,
				realm: sandboxRealm,
			});
			admissionPending = preparation;
			const ticket = ownerPreparation
				? await awaitImagePreprocessDeadline({
						promise: preparation,
						signal: linked!,
					})
				: await preparation;
			return await runMvNativeRaster({
				ticket,
				signal: linked,
				imagePreprocessOwner,
			});
		} finally {
			clearTimeout(timer);
			if (admissionPending && releaseEncoded) {
				const release = releaseEncoded;
				void admissionPending.then(release, release);
			} else releaseEncoded?.();
			if (ownsPreprocessor) imagePreprocessOwner?.dispose();
		}
	}
	frame = await resolveMvResourceFrame({
		source,
		frame,
		resources,
		signal,
		realm: sandboxRealm,
	});
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
		realm: sandboxRealm,
	});
}
