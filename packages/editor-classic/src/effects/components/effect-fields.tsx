import { useRef, useState } from "react";
import { useEditorInstance } from "../../editor/use-editor";
import type { ParamValues } from "../../params";
import type { ElementAnimations } from "../../animation/types";
import { findTrackInSceneTracks } from "../../timeline";
import type { EffectElement, VisualElement } from "../../timeline";
import type { Effect } from "../types";
import { effectsRegistry } from "..";
import { BubbleTrajectoryFields } from "./bubble-trajectory-fields";
import { FrostStrokeFields } from "./frost-stroke-fields";
import { frostFieldGroups } from "./frost-stroke-edit";
import { FrostNumberField } from "./frost-number-field";
import { CanvasStrokeFields } from "./canvas-stroke-fields";
import { CanvasNumberField } from "./canvas-number-field";
import { canvasFieldGroups } from "./canvas-stroke-edit";
import { flameWrapFieldGroups } from "./flame-wrap-field-groups";
import { saveEffectPreview } from "./effect-save-feedback";
import { EffectParamField } from "./effect-param-field";

export function EffectFields({
	effect,
	element,
	trackId,
	params,
	previewParams,
	commit,
}: {
	effect: Effect;
	element: EffectElement | VisualElement;
	trackId: string;
	params: ParamValues;
	previewParams: (updates: {
		params: ParamValues;
		animations?: ElementAnimations;
	}) => void;
	commit: () => Promise<boolean>;
}) {
	const editor = useEditorInstance();
	const changed = useRef(false);
	const pending = useRef(false);
	const [message, setMessage] = useState("");
	const [saving, setSaving] = useState(false);
	const [retained, setRetained] = useState<ParamValues | null>(null);
	const [retainedAnimations, setRetainedAnimations] =
		useState<ElementAnimations>();
	const definitions = effectsRegistry.get(effect.type).params;
	const displayed = retained ?? params;
	const preview = (next: ParamValues) => {
		if (pending.current) return;
		changed.current = true;
		if (retained) setRetained(next);
		previewParams({ params: next, animations: retainedAnimations });
	};
	const save = async () => {
		if (pending.current) return;
		if (!changed.current) return;
		pending.current = true;
		setSaving(true);
		try {
			const tracks = editor.timeline.getPreviewTracks();
			const candidate = tracks
				? findTrackInSceneTracks({ tracks, trackId })?.elements.find(
						(item) => item.id === element.id,
					)
				: element;
			const attemptedAnimations = candidate?.animations;
			const attemptedParams =
				candidate?.type === "effect"
					? candidate.params
					: candidate && "effects" in candidate
						? (candidate.effects?.find((item) => item.id === effect.id)
								?.params ?? displayed)
						: displayed;
			const error = await saveEffectPreview({
				commit,
				discard: () => editor.timeline.discardPreview(),
			});
			setMessage(error);
			setRetained(error ? attemptedParams : null);
			setRetainedAnimations(error ? attemptedAnimations : undefined);
			changed.current = false;
		} finally {
			pending.current = false;
			setSaving(false);
		}
	};
	const isBubble = effect.type === "bubble";
	const fields = definitions.filter(
		(param) => !isBubble || !/^point(?:Count|\d+(?:Time|X|Y))$/.test(param.key),
	);
	const groups =
		effect.type === "flame-wrap"
			? flameWrapFieldGroups({ definitions })
			: effect.type === "canvas"
				? canvasFieldGroups({ definitions })
				: effect.type === "frost"
					? frostFieldGroups({ definitions })
					: isBubble
						? [
								{
									label: "Optics",
									params: fields.filter((param) => param.keyframable === true),
								},
								{
									label: "Activity",
									params: fields.filter((param) => param.keyframable !== true),
								},
							]
						: [{ label: "", params: fields }];
	return (
		<fieldset
			disabled={saving}
			aria-busy={saving}
			className="min-w-0 flex flex-col gap-4 px-4"
		>
			{message && (
				<p role="alert" className="text-xs text-destructive">
					{message} Unsaved inputs are shown below.
				</p>
			)}
			{groups.map((group) => (
				<div key={group.label} className="flex flex-col gap-3.5">
					{group.label && (
						<h4 className="text-sm font-medium">{group.label}</h4>
					)}
					{group.params.map((param) =>
						effect.type === "canvas" ? (
							<CanvasNumberField
								key={param.key}
								param={param}
								value={displayed[param.key]}
								onPreview={(value) =>
									preview({ ...displayed, [param.key]: value })
								}
								onCommit={() => void save()}
							/>
						) : (effect.type === "frost" || effect.type === "flame-wrap") &&
						  param.keyframable !== true ? (
							<FrostNumberField
								key={param.key}
								param={param}
								value={
									effect.type === "frost" && param.required !== false
										? displayed[param.key]
										: (displayed[param.key] ?? param.default)
								}
								onPreview={(value) =>
									preview({ ...displayed, [param.key]: value })
								}
								onCommit={() => void save()}
							/>
						) : (
							<EffectParamField
								key={param.key}
								param={param}
								effect={effect}
								element={
									retainedAnimations
										? { ...element, animations: retainedAnimations }
										: element
								}
								trackId={trackId}
								params={displayed}
								preview={preview}
								commit={() => void save()}
								reportError={setMessage}
								hasUnsavedDraft={retained !== null}
								prepareAnimated={() => {
									if (retained)
										previewParams({
											params: displayed,
											animations: retainedAnimations,
										});
								}}
								rememberAnimated={() => {
									changed.current = true;
									if (retained) {
										const tracks = editor.timeline.getPreviewTracks();
										if (tracks)
											setRetainedAnimations(
												findTrackInSceneTracks({
													tracks,
													trackId,
												})?.elements.find((item) => item.id === element.id)
													?.animations,
											);
									}
								}}
							/>
						),
					)}
				</div>
			))}
			{effect.type === "canvas" && (
				<CanvasStrokeFields
					params={displayed}
					definitions={definitions}
					preview={preview}
					commit={() => void save()}
				/>
			)}
			{isBubble && (
				<BubbleTrajectoryFields
					params={displayed}
					definitions={definitions}
					preview={preview}
					commit={() => void save()}
				/>
			)}
			{effect.type === "frost" && (
				<FrostStrokeFields
					params={displayed}
					definitions={definitions}
					preview={preview}
					commit={() => void save()}
				/>
			)}
		</fieldset>
	);
}
