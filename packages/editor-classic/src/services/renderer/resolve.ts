import { getElementLocalTime } from "../../animation";
import { effectsRegistry, resolveEffectPasses } from "../../effects";
import { resolveEffectLayerParams } from "../../wasm/effect-layer-animation";
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
import { createVideoFrameScope } from "./video-frame-scope";
import type { CanvasRenderer } from "./canvas-renderer";
import type { AnyBaseNode } from "./nodes/base-node";
import { BlurBackgroundNode } from "./nodes/blur-background-node";
import {
	EffectLayerNode,
	type ResolvedEffectLayerNodeState,
} from "./nodes/effect-layer-node";
import {
	GraphicNode,
	type ResolvedGraphicNodeState,
} from "./nodes/graphic-node";
import { ImageNode } from "./nodes/image-node";
import { ProgrammaticNode } from "./nodes/programmatic-node";
import { StickerNode, loadStickerSource } from "./nodes/sticker-node";
import { TextNode, type ResolvedTextNodeState } from "./nodes/text-node";
import { VideoNode } from "./nodes/video-node";
import {
	MotionTextNode,
	MotionTextRenderResourceError,
	type ResolvedMotionTextNodeState,
} from "./nodes/motion-text-node";
import { resolveMotionTextRenderFrame } from "./motion-text/jizura-adapter";
import type { ResolvedVisualSourceNodeState } from "./nodes/visual-node";
import { VisualNode } from "./nodes/visual-node";
import type { ResolveContext } from "./resolve-context";
import {
	resolveEffectPassGroups,
	resolveVisualState,
} from "./resolve-visual-state";
import {
	resolveVideoNode,
	resolveImageNode,
	resolveBlurBackgroundNode,
} from "./resolve-picture";
import { TransitionTrackNode } from "./nodes/transition-track-node";
import { resolveTransitionTrack } from "./resolve-transition-track";
import type { FrameRate } from "opencut-wasm";
import type { RenderTreeResidencyScope } from "./render-residency-domain";

export async function resolveRenderTree({
	node,
	renderer,
	time,
	videoCache,
	frameRate,
	rasterResidency,
	signal,
}: {
	node: AnyBaseNode;
	renderer: Pick<CanvasRenderer, "width" | "height">;
	time: number;
	videoCache: Pick<VideoCache, "getFrameAt">;
	frameRate?: FrameRate;
	rasterResidency?: RenderTreeResidencyScope;
	signal?: AbortSignal;
}): Promise<void> {
	await resolveNode({
		node,
		context: {
			rasterResidency,
			signal,
			renderer,
			time,
			frameRate,
			videoCache: createVideoFrameScope(videoCache),
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
	if (node instanceof TransitionTrackNode) {
		await resolveTransitionTrack({ node, context, resolveNode });
		return;
	}
	if (node instanceof ProgrammaticNode) {
		node.resolved = await node.resolve(context);
	} else if (node instanceof VideoNode) {
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
		node.resolved = await resolveTextNode({ node, context });
	} else if (node instanceof BlurBackgroundNode) {
		node.resolved = await resolveBlurBackgroundNode({ node, context });
	} else if (node instanceof EffectLayerNode) {
		node.resolved = resolveEffectLayerNode({ node, context });
	}

	if (node instanceof VisualNode) await node.prepareMasks(context.signal);

	const settled = await Promise.allSettled(
		node.children.map((child) => resolveNode({ node: child, context })),
	);
	for (const entry of settled)
		if (entry.status === "rejected") throw entry.reason;
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

async function resolveTextNode({
	node,
	context,
}: {
	node: TextNode;
	context: ResolveContext;
}): Promise<ResolvedTextNodeState | null> {
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
	const measurementParams = await node.measurementParams(context.signal);

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
			frameRate: context.frameRate,
		}),
		measuredText: measureTextElement({
			element: measurementParams,
			canvasHeight: node.params.canvasHeight,
			localTime,
			ctx: getTextMeasurementContext(),
		}),
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
		time < node.params.timeOffset ||
		time >= node.params.timeOffset + node.params.duration
	) {
		return null;
	}

	const definition = effectsRegistry.get(node.params.effectType);
	const localTicks = time - node.params.timeOffset;
	const effectParams =
		node.params.animations && Object.keys(node.params.animations).length > 0
			? resolveEffectLayerParams({
					request: {
						effectType: node.params.effectType,
						params: node.params.effectParams,
						animations: node.params.animations,
						localTicks,
					},
				})
			: node.params.effectParams;
	const passes = resolveEffectPasses({
		definition,
		effectParams,
		width: context.renderer.width,
		height: context.renderer.height,
		frame: context.frameRate
			? {
					localTime: localTicks,
					frameRate: context.frameRate,
				}
			: undefined,
	});
	if (passes.length === 0) {
		return null;
	}

	return {
		passes,
	};
}
