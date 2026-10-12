import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../../../base-command";
import { removeEffectParamKeyframe } from "../../../../animation/effect-param-channel";
import {
	buildEffectParamPath,
	buildGraphicParamPath,
	removeElementKeyframe,
} from "../../../../animation";
import { admitAnimationTargetChannels } from "../../../../animation/scalar-admission";
import { updateElementInSceneTracks } from "../../../../timeline";
import { isVisualElement } from "../../../../timeline/element-utils";
import type {
	EffectElement,
	SceneTracks,
	VisualElement,
} from "../../../../timeline";
import { resolveAnimationTarget } from "../../../../timeline/animation-targets";

export class RemoveEffectParamKeyframeCommand extends Command {
	readonly routingClass = "transaction" as const;

	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly effectId: string;
	private readonly paramKey: string;
	private readonly keyframeId: string;

	constructor({
		trackId,
		elementId,
		effectId,
		paramKey,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		keyframeId: string;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.effectId = effectId;
		this.paramKey = paramKey;
		this.keyframeId = keyframeId;
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			elementPredicate: (element): element is VisualElement | EffectElement =>
				isVisualElement(element) || element.type === "effect",
			update: (element) => {
				if (element.type === "effect") {
					if (this.effectId !== element.id) return element;
				}
				const propertyPath =
					element.type === "effect"
						? buildGraphicParamPath({ paramKey: this.paramKey })
						: buildEffectParamPath({
								effectId: this.effectId,
								paramKey: this.paramKey,
							});
				const target = resolveAnimationTarget({ element, path: propertyPath });
				if (element.type === "effect" && !target) return element;
				const animations =
					element.type === "effect"
						? removeElementKeyframe({
								animations: element.animations,
								propertyPath,
								keyframeId: this.keyframeId,
							})
						: removeEffectParamKeyframe({
								animations: element.animations,
								effectId: this.effectId,
								paramKey: this.paramKey,
								keyframeId: this.keyframeId,
							});
				// Unknown legacy attached channels remain explicitly removable.
				const admissions = target
					? admitAnimationTargetChannels({
							animations,
							propertyPath,
							duration: element.duration,
							target,
						})
					: [];
				for (const admission of admissions)
					if (admission.kind === "rejected")
						throw new RangeError(admission.reason);
				return { ...element, animations };
			},
		});

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		if (!this.savedState) {
			return;
		}

		editor.timeline.updateTracks(this.savedState);
	}
}
