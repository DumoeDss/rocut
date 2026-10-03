import { mediaTimeToSeconds, roundMediaTime } from "../../wasm";
import { getElementLocalTime } from "../../animation";
import { resolveEffectParamsAtTime } from "../../animation/effect-param-channel";
import {
	buildGaussianBlurPasses,
	intensityToSigma,
} from "../../effects/definitions/blur";
import { effectsRegistry, resolveEffectPasses } from "../../effects";
import type { Effect, EffectPass } from "../../effects/types";
import { resolveVideoSourceTime } from "../../wasm/video-time";
import {
	DEFAULT_GRAPHIC_SOURCE_SIZE,
	resolveGraphicElementParamsAtTime,
} from "../../graphics";
import {
	buildTextBackgroundFromElement,
	getTextMeasurementContext,
	measureTextElement,
} from "../../text/measure-element";
import {
	resolveColorAtTime,
	resolveOpacityAtTime,
} from "../../animation/values";
import { resolveTransformAtTime } from "../../rendering/animation-values";
import type { VideoCache } from "../video-cache/service";
import type { CanvasRenderer } from "./canvas-renderer";
import type { AnyBaseNode } from "./nodes/base-node";
import {
	BlurBackgroundNode,
	type BackdropSource,
	type ResolvedBlurBackgroundNodeState,
} from "./nodes/blur-background-node";
import {
	EffectLayerNode,
	type ResolvedEffectLayerNodeState,
} from "./nodes/effect-layer-node";
import {
	GraphicNode,
	type ResolvedGraphicNodeState,
} from "./nodes/graphic-node";
import { ImageNode, loadImageSource } from "./nodes/image-node";
import { StickerNode, loadStickerSource } from "./nodes/sticker-node";
import { TextNode, type ResolvedTextNodeState } from "./nodes/text-node";
import { VideoNode } from "./nodes/video-node";
import {
	MotionTextNode,
	MotionTextRenderResourceError,
	type ResolvedMotionTextNodeState,
} from "./nodes/motion-text-node";
import { resolveMotionTextRenderFrame } from "./motion-text/jizura-adapter";
import type {
	ResolvedVisualNodeState,
	ResolvedVisualSourceNodeState,
	VisualNodeParams,
} from "./nodes/visual-node";

type ResolveContext = {
	renderer: Pick<CanvasRenderer, "width" | "height">;
	time: number;
	videoCache: Pick<VideoCache, "getFrameAt">;
};

export async function resolveRenderTree({
	node,
	renderer,
	time,
	videoCache,
}: {
	node: AnyBaseNode;
	renderer: Pick<CanvasRenderer, "width" | "height">;
	time: number;
	videoCache: Pick<VideoCache, "getFrameAt">;
}): Promise<void> {
	await resolveNode({
		node,
		context: {
			renderer,
			time,
			videoCache,
		},
	});
}

async function resolveNode({
	node,
	context,
}: {
	node: AnyBaseNode;
	context: ResolveContext;
}): Promise<void> {
	if (node instanceof VideoNode) {
		node.resolved = await resolveVideoNode({ node, context });
	} else if (node instanceof ImageNode) {
		node.resolved = await resolveImageNode({ node, context });
	} else if (node instanceof StickerNode) {
		node.resolved = await resolveStickerNode({ node, context });
	} else if (node instanceof GraphicNode) {
		node.resolved = resolveGraphicNode({ node, context });
	} else if (node instanceof MotionTextNode) {
		node.resolved = await resolveMotionTextNode({ node, context });
	} else if (node instanceof TextNode) {
		node.resolved = resolveTextNode({ node, context });
	} else if (node instanceof BlurBackgroundNode) {
		node.resolved = await resolveBlurBackgroundNode({ node, context });
	} else if (node instanceof EffectLayerNode) {
		node.resolved = resolveEffectLayerNode({ node, context });
	}

	await Promise.all(
		node.children.map((child) => resolveNode({ node: child, context })),
	);
}

async function resolveMotionTextNode({
	node,
	context,
}: {
	node: MotionTextNode;
	context: ResolveContext;
}): Promise<ResolvedMotionTextNodeState | null> {
	const mapping = node.mapClipTime({
		clipStartTime: node.params.timeOffset,
		clipDuration: node.params.duration,
		trimStart: node.params.trimStart,
		timelineTime: context.time,
		sequenceDuration: node.params.sequence.duration,
	});
	if (!mapping.active || mapping.sequenceTime == null) {
		node.diagnostics = node.runtime.baseDiagnostics;
		return null;
	}
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: context.renderer.width,
		sourceHeight: context.renderer.height,
	});
	if (!visualState) return null;
	const runtime = await node.getRenderRuntime();
	if (
		node.params.renderPurpose === "export" &&
		runtime.baseDiagnostics.some(({ severity }) => severity === "error")
	) {
		node.diagnostics = runtime.baseDiagnostics;
		throw new MotionTextRenderResourceError(runtime.baseDiagnostics);
	}
	const frame = resolveMotionTextRenderFrame({
		runtime,
		sequenceTime: mapping.sequenceTime,
	});
	if (!frame) {
		node.diagnostics = node.runtime.baseDiagnostics;
		return null;
	}
	node.diagnostics = frame.diagnostics;
	return {
		...visualState,
		frame,
		contentHash: `motion-text:v1:${context.renderer.width}x${context.renderer.height}:${frame.contentFingerprint}`,
	};
}

function resolveEffectPassGroups({
	effects,
	animations,
	localTime,
	width,
	height,
}: {
	effects: Effect[] | undefined;
	animations: VisualNodeParams["animations"];
	localTime: number;
	width: number;
	height: number;
}): EffectPass[][] {
	return (effects ?? [])
		.filter((effect) => effect.enabled)
		.map((effect) => {
			const resolvedParams = resolveEffectParamsAtTime({
				effectId: effect.id,
				params: effect.params,
				animations,
				localTime,
			});
			const definition = effectsRegistry.get(effect.type);
			return resolveEffectPasses({
				definition,
				effectParams: resolvedParams,
				width,
				height,
			});
		});
}

function resolveVisualState({
	params,
	context,
	sourceWidth,
	sourceHeight,
}: {
	params: VisualNodeParams;
	context: ResolveContext;
	sourceWidth: number;
	sourceHeight: number;
}): ResolvedVisualNodeState | null {
	const clipTime = context.time - params.timeOffset;
	if (clipTime < 0 || clipTime >= params.duration) {
		return null;
	}

	const localTime = getElementLocalTime({
		timelineTime: context.time,
		elementStartTime: params.timeOffset,
		elementDuration: params.duration,
	});
	const transform = resolveTransformAtTime({
		baseTransform: params.transform,
		animations: params.animations,
		localTime,
	});
	const opacity = resolveOpacityAtTime({
		baseOpacity: params.opacity,
		animations: params.animations,
		localTime,
	});
	const containScale = Math.min(
		context.renderer.width / sourceWidth,
		context.renderer.height / sourceHeight,
	);
	const effectWidth = Math.round(
		Math.abs(sourceWidth * containScale * transform.scaleX),
	);
	const effectHeight = Math.round(
		Math.abs(sourceHeight * containScale * transform.scaleY),
	);

	return {
		localTime,
		transform,
		opacity,
		effectPasses: resolveEffectPassGroups({
			effects: params.effects,
			animations: params.animations,
			localTime,
			width: effectWidth,
			height: effectHeight,
		}),
	};
}

async function resolveVideoNode({
	node,
	context,
}: {
	node: VideoNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const clipTime = context.time - node.params.timeOffset;
	if (clipTime < 0 || clipTime >= node.params.duration) {
		return null;
	}

	const sourceTimeTicks = resolveVideoSourceTime({
		clipTime,
		trimStart: node.params.trimStart,
		playbackRate: node.params.retime?.rate ?? 1,
		freezeFrame: node.params.freezeFrame,
	});
	if (sourceTimeTicks === null) return null;
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

	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: frame.canvas.width,
		sourceHeight: frame.canvas.height,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: frame.canvas,
		sourceVersion: `${node.params.mediaId}:${frame.timestamp}`,
		sourceWidth: frame.canvas.width,
		sourceHeight: frame.canvas.height,
	};
}

async function resolveImageNode({
	node,
	context,
}: {
	node: ImageNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const source = await loadImageSource({
		url: node.params.url,
		maxSourceSize: node.params.maxSourceSize,
	});
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: source.width,
		sourceHeight: source.height,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: source.source,
		sourceWidth: source.width,
		sourceHeight: source.height,
	};
}

async function resolveStickerNode({
	node,
	context,
}: {
	node: StickerNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const source = await loadStickerSource({
		stickerId: node.params.stickerId,
		assets: node.params.assets,
	});
	const sourceWidth = node.params.intrinsicWidth ?? source.width;
	const sourceHeight = node.params.intrinsicHeight ?? source.height;
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth,
		sourceHeight,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: source.source,
		sourceWidth,
		sourceHeight,
	};
}

function resolveGraphicNode({
	node,
	context,
}: {
	node: GraphicNode;
	context: ResolveContext;
}): ResolvedGraphicNodeState | null {
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: DEFAULT_GRAPHIC_SOURCE_SIZE,
		sourceHeight: DEFAULT_GRAPHIC_SOURCE_SIZE,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		resolvedParams: resolveGraphicElementParamsAtTime({
			element: node.params,
			localTime: visualState.localTime,
		}),
	};
}

function resolveTextNode({
	node,
	context,
}: {
	node: TextNode;
	context: ResolveContext;
}): ResolvedTextNodeState | null {
	if (
		context.time < node.params.startTime ||
		context.time >= node.params.startTime + node.params.duration
	) {
		return null;
	}

	const localTime = getElementLocalTime({
		timelineTime: context.time,
		elementStartTime: node.params.startTime,
		elementDuration: node.params.duration,
	});
	const background = buildTextBackgroundFromElement({ element: node.params });

	return {
		transform: resolveTransformAtTime({
			baseTransform: node.params.transform,
			animations: node.params.animations,
			localTime,
		}),
		opacity: resolveOpacityAtTime({
			baseOpacity: node.params.opacity,
			animations: node.params.animations,
			localTime,
		}),
		textColor: resolveColorAtTime({
			baseColor:
				typeof node.params.params.color === "string"
					? node.params.params.color
					: "#ffffff",
			animations: node.params.animations,
			propertyPath: "color",
			localTime,
		}),
		backgroundColor: resolveColorAtTime({
			baseColor: background.color,
			animations: node.params.animations,
			propertyPath: "background.color",
			localTime,
		}),
		effectPasses: resolveEffectPassGroups({
			effects: node.params.effects,
			animations: node.params.animations,
			localTime,
			width: context.renderer.width,
			height: context.renderer.height,
		}),
		measuredText: measureTextElement({
			element: node.params,
			canvasHeight: node.params.canvasHeight,
			localTime,
			ctx: getTextMeasurementContext(),
		}),
	};
}

async function resolveBlurBackgroundNode({
	node,
	context,
}: {
	node: BlurBackgroundNode;
	context: ResolveContext;
}): Promise<ResolvedBlurBackgroundNodeState | null> {
	const clipTime = context.time - node.params.timeOffset;
	if (clipTime < 0 || clipTime >= node.params.duration) {
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
		const sourceTimeTicks = resolveVideoSourceTime({
			clipTime,
			trimStart: node.params.trimStart,
			playbackRate: node.params.retime?.rate ?? 1,
			freezeFrame: node.params.freezeFrame,
		});
		if (sourceTimeTicks === null) return null;
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

		return {
			source: frame.canvas,
			sourceVersion: `${node.params.mediaId}:${frame.timestamp}`,
			width: frame.canvas.width,
			height: frame.canvas.height,
		};
	}

	const source = await loadImageSource({ url: node.params.url });
	return {
		source: source.source,
		width: source.width,
		height: source.height,
	};
}

function resolveEffectLayerNode({
	node,
	context,
}: {
	node: EffectLayerNode;
	context: ResolveContext;
}): ResolvedEffectLayerNodeState | null {
	const time = context.time;
	if (
		time < node.params.timeOffset - 1e-6 ||
		time >= node.params.timeOffset + node.params.duration + 1e-6
	) {
		return null;
	}

	const definition = effectsRegistry.get(node.params.effectType);
	const passes = resolveEffectPasses({
		definition,
		effectParams: node.params.effectParams,
		width: context.renderer.width,
		height: context.renderer.height,
	});
	if (passes.length === 0) {
		return null;
	}

	return {
		passes,
	};
}
