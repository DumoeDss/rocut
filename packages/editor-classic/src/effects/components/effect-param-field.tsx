import {
	buildEffectParamPath,
	buildGraphicParamPath,
	resolveAnimationPathValueAtTime,
} from "../../animation";
import { PropertyParamField } from "../../components/editor/panels/properties/components/property-param-field";
import { useElementPlayhead } from "../../components/editor/panels/properties/hooks/use-element-playhead";
import { useKeyframedParamProperty } from "../../components/editor/panels/properties/hooks/use-keyframed-param-property";
import { useEditorInstance } from "../../editor/use-editor";
import type { ParamDefinition, ParamValues } from "../../params";
import type {
	EffectElement,
	VisualElement,
	TimelineElement,
} from "../../timeline";
import type { Effect } from "../types";
import { FrostNumberField } from "./frost-number-field";

export function EffectParamField({
	param,
	effect,
	element,
	trackId,
	params,
	preview,
	commit,
	reportError,
	hasUnsavedDraft,
	prepareAnimated,
	rememberAnimated,
}: {
	param: ParamDefinition;
	effect: Effect;
	element: EffectElement | VisualElement;
	trackId: string;
	params: ParamValues;
	preview: (params: ParamValues) => void;
	commit: () => void;
	reportError: (message: string) => void;
	hasUnsavedDraft: boolean;
	prepareAnimated: () => void;
	rememberAnimated: () => void;
}) {
	const editor = useEditorInstance();
	const { localTime, isPlayheadWithinElementRange } =
		useElementPlayhead(element);
	const propertyPath =
		element.type === "effect"
			? buildGraphicParamPath({ paramKey: param.key })
			: buildEffectParamPath({ effectId: effect.id, paramKey: param.key });
	const fallbackValue = params[param.key] ?? param.default;
	const preservesInput =
		effect.type === "frost" || effect.type === "flame-wrap";
	const Field = preservesInput ? FrostNumberField : PropertyParamField;
	const resolvedValue =
		param.keyframable === true &&
		(!preservesInput || typeof fallbackValue === "number")
			? resolveAnimationPathValueAtTime({
					animations: element.animations,
					propertyPath,
					localTime,
					fallbackValue,
				})
			: fallbackValue;
	const buildBaseUpdates = ({
		value,
	}: {
		value: number | string | boolean;
	}): Partial<TimelineElement> =>
		element.type === "effect"
			? { params: { ...params, [param.key]: value } }
			: {
					effects: (element.effects ?? []).map((item) =>
						item.id === effect.id
							? { ...item, params: { ...params, [param.key]: value } }
							: item,
					),
				};
	const animated = useKeyframedParamProperty({
		param,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath,
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue,
		buildBaseUpdates,
		coerceValue: preservesInput ? ({ value }) => value : undefined,
	});
	const toggle = async () => {
		try {
			if (animated.keyframeIdAtTime)
				await editor.timeline.removeKeyframes({
					keyframes: [
						{
							trackId,
							elementId: element.id,
							propertyPath,
							keyframeId: animated.keyframeIdAtTime,
						},
					],
				});
			else
				await editor.timeline.upsertKeyframes({
					keyframes: [
						{
							trackId,
							elementId: element.id,
							propertyPath,
							time: localTime,
							value: resolvedValue,
						},
					],
				});
			reportError("");
		} catch {
			reportError(
				"Keyframe was not saved. Check the effect values and try again.",
			);
		}
	};
	return (
		<Field
			param={param}
			value={resolvedValue}
			onPreview={(value) => {
				if (
					param.keyframable === true &&
					animated.hasAnimatedKeyframes &&
					isPlayheadWithinElementRange &&
					(!preservesInput || typeof value === "number")
				) {
					prepareAnimated();
					if (preservesInput && typeof fallbackValue !== "number")
						preview({ ...params, [param.key]: value });
					animated.onPreview(value);
					rememberAnimated();
				} else {
					// Invalid numeric text stays in the draft for native admission.
					preview({ ...params, [param.key]: value });
				}
			}}
			onCommit={commit}
			keyframe={
				param.keyframable === true
					? {
							isActive: animated.isKeyframedAtTime,
							isDisabled: hasUnsavedDraft || !isPlayheadWithinElementRange,
							onToggle: () => void toggle(),
						}
					: undefined
			}
		/>
	);
}
