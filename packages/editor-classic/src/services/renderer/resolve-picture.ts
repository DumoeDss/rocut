import { mediaTimeToSeconds, roundMediaTime } from "../../wasm";
import { resolveVideoSourceTime } from "../../wasm/video-time";
import {
	buildGaussianBlurPasses,
	intensityToSigma,
} from "../../effects/definitions/blur";
import { VideoNode } from "./nodes/video-node";
import { ImageNode, loadImageSource } from "./nodes/image-node";
import {
	BlurBackgroundNode,
	type BackdropSource,
	type ResolvedBlurBackgroundNodeState,
} from "./nodes/blur-background-node";
import type { ResolvedVisualSourceNodeState } from "./nodes/visual-node";
import { resolveVisualState } from "./resolve-visual-state";
import type { ResolveContext } from "./resolve-context";
import { resolveMediaCrop } from "../../wasm/media-crop";

export async function resolveVideoNode({
	node,
	context,
}: {
	node: VideoNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const clipTime = context.time - node.params.timeOffset;
	if (!context.sample && (clipTime < 0 || clipTime >= node.params.duration)) {
		return null;
	}

	const sourceTimeTicks = context.sample
		? context.sample.sourceTime
		: resolveVideoSourceTime({
				clipTime,
				trimStart: node.params.trimStart,
				playbackRate: node.params.retime?.rate ?? 1,
				reverse: node.params.retime?.reverse,
				clipDuration: node.params.duration,
				freezeFrame: node.params.freezeFrame,
			});
	if (sourceTimeTicks == null) return null;
	const frame = await context.videoCache.getFrameAt({
		mediaId: node.params.mediaId,
		file: node.params.file,
		time: mediaTimeToSeconds({
			time: roundMediaTime({ time: sourceTimeTicks }),
		}),
	});
	if (!frame) {
		return null;
	}

	const sourceCrop = resolveMediaCrop({
		crop: node.params.crop,
		sourceWidth: frame.canvas.width,
		sourceHeight: frame.canvas.height,
	});
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: sourceCrop?.width ?? frame.canvas.width,
		sourceHeight: sourceCrop?.height ?? frame.canvas.height,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: frame.canvas,
		sourceVersion: `${node.params.mediaId}:${frame.timestamp}`,
		sourceWidth: sourceCrop?.width ?? frame.canvas.width,
		sourceHeight: sourceCrop?.height ?? frame.canvas.height,
		sourceCrop,
	};
}

export async function resolveImageNode({
	node,
	context,
}: {
	node: ImageNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const clipTime = context.time - node.params.timeOffset;
	if (!context.sample && (clipTime < 0 || clipTime >= node.params.duration))
		return null;
	const source = await loadImageSource({
		url: node.params.url,
		maxSourceSize: node.params.maxSourceSize,
	});
	const sourceCrop = resolveMediaCrop({
		crop: node.params.crop,
		sourceWidth: source.width,
		sourceHeight: source.height,
	});
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: sourceCrop?.width ?? source.width,
		sourceHeight: sourceCrop?.height ?? source.height,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: source.source,
		sourceWidth: sourceCrop?.width ?? source.width,
		sourceHeight: sourceCrop?.height ?? source.height,
		sourceCrop,
	};
}

export async function resolveBlurBackgroundNode({
	node,
	context,
}: {
	node: BlurBackgroundNode;
	context: ResolveContext;
}): Promise<ResolvedBlurBackgroundNodeState | null> {
	const clipTime = context.time - node.params.timeOffset;
	if (!context.sample && (clipTime < 0 || clipTime >= node.params.duration)) {
		return null;
	}

	const backdropSource = await resolveBackdropSource({
		node,
		clipTime,
		context,
	});
	if (!backdropSource) {
		return null;
	}

	return {
		backdropSource,
		passes: buildGaussianBlurPasses({
			sigmaX: intensityToSigma({
				intensity: node.params.blurIntensity,
				resolution: context.renderer.width,
				reference: 1920,
			}),
			sigmaY: intensityToSigma({
				intensity: node.params.blurIntensity,
				resolution: context.renderer.height,
				reference: 1080,
			}),
		}),
	};
}

async function resolveBackdropSource({
	node,
	clipTime,
	context,
}: {
	node: BlurBackgroundNode;
	clipTime: number;
	context: ResolveContext;
}): Promise<BackdropSource | null> {
	if (node.params.mediaType === "video") {
		const sourceTimeTicks = context.sample
			? context.sample.sourceTime
			: resolveVideoSourceTime({
					clipTime,
					trimStart: node.params.trimStart,
					playbackRate: node.params.retime?.rate ?? 1,
					reverse: node.params.retime?.reverse,
					clipDuration: node.params.duration,
					freezeFrame: node.params.freezeFrame,
				});
		if (sourceTimeTicks == null) return null;
		const frame = await context.videoCache.getFrameAt({
			mediaId: node.params.mediaId,
			file: node.params.file,
			time: mediaTimeToSeconds({
				time: roundMediaTime({ time: sourceTimeTicks }),
			}),
		});
		if (!frame) {
			return null;
		}

		const sourceCrop = resolveMediaCrop({
			crop: node.params.crop,
			sourceWidth: frame.canvas.width,
			sourceHeight: frame.canvas.height,
		});
		return {
			source: frame.canvas,
			sourceVersion: `${node.params.mediaId}:${frame.timestamp}`,
			width: sourceCrop?.width ?? frame.canvas.width,
			height: sourceCrop?.height ?? frame.canvas.height,
			sourceCrop,
		};
	}

	const source = await loadImageSource({ url: node.params.url });
	const sourceCrop = resolveMediaCrop({
		crop: node.params.crop,
		sourceWidth: source.width,
		sourceHeight: source.height,
	});
	return {
		source: source.source,
		width: sourceCrop?.width ?? source.width,
		height: sourceCrop?.height ?? source.height,
		sourceCrop,
	};
}
