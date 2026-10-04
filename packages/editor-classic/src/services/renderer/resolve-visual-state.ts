import { getElementLocalTime } from "../../animation";
import { resolveEffectParamsAtTime } from "../../animation/effect-param-channel";
import { effectsRegistry, resolveEffectPasses } from "../../effects";
import type { Effect, EffectPass } from "../../effects/types";
import { resolveOpacityAtTime } from "../../animation/values";
import { resolveTransformAtTime } from "../../rendering/animation-values";
import type {
	ResolvedVisualNodeState,
	VisualNodeParams,
} from "./nodes/visual-node";
import type { ResolveContext } from "./resolve-context";

export function resolveEffectPassGroups({
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
