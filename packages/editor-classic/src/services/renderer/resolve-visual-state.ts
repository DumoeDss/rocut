import { getElementLocalTime } from "../../animation";
import { resolveEffectParamsAtTime } from "../../animation/effect-param-channel";
import { ScalarBatchResolver } from "../../animation/scalar-batch-resolver";
import { effectsRegistry, resolveEffectPasses } from "../../effects";
import type { Effect, EffectPass } from "../../effects/types";
import { resolveOpacityAtTime } from "../../animation/values";
import { resolveTransformAtTime } from "../../rendering/animation-values";
import type {
	ResolvedVisualNodeState,
	VisualNodeParams,
} from "./nodes/visual-node";
import type { ResolveContext } from "./resolve-context";
import type { FrameRate } from "opencut-wasm";

export function resolveEffectPassGroups({
	effects,
	animations,
	localTime,
	scalarBatch,
	width,
	height,
	frameRate,
}: {
	effects: Effect[] | undefined;
	animations: VisualNodeParams["animations"];
	localTime: number;
	scalarBatch?: ScalarBatchResolver;
	width: number;
	height: number;
	frameRate?: FrameRate;
}): EffectPass[][] {
	return (effects ?? [])
		.filter((effect) => effect.enabled)
		.map((effect) => {
			const resolvedParams = resolveEffectParamsAtTime({
				effectId: effect.id,
				params: effect.params,
				animations,
				localTime,
				scalarBatch,
			});
			const definition = effectsRegistry.get(effect.type);
			return resolveEffectPasses({
				definition,
				effectParams: resolvedParams,
				width,
				height,
				frame: frameRate ? { localTime, frameRate } : undefined,
			});
		})
		.filter((passes) => passes.length > 0);
}

export function resolveVisualState({
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
	if (!context.sample && (clipTime < 0 || clipTime >= params.duration)) {
		return null;
	}

	const localTime =
		context.sample?.localTime ??
		getElementLocalTime({
			timelineTime: context.time,
			elementStartTime: params.timeOffset,
			elementDuration: params.duration,
		});
	const safeLocalTime = Math.max(0, localTime);
	const scalarPaths = [
		"transform.positionX",
		"transform.positionY",
		"transform.scaleX",
		"transform.scaleY",
		"transform.rotate",
		"opacity",
	];
	for (const effect of params.effects ?? []) {
		for (const paramKey of Object.keys(effect.params ?? {})) {
			scalarPaths.push(`effects.${effect.id}.params.${paramKey}`);
		}
	}
	const scalarBatch = new ScalarBatchResolver({ time: safeLocalTime });
	scalarBatch.plan({ animations: params.animations, paths: scalarPaths });
	scalarBatch.execute();
	const transform = resolveTransformAtTime({
		baseTransform: params.transform,
		animations: params.animations,
		localTime: safeLocalTime,
		scalarBatch,
	});
	const opacity = resolveOpacityAtTime({
		baseOpacity: params.opacity,
		animations: params.animations,
		localTime: safeLocalTime,
		scalarBatch,
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
			localTime: safeLocalTime,
			scalarBatch,
			width: effectWidth,
			height: effectHeight,
			frameRate: context.frameRate,
		}),
	};
}
