import { updateScalarKeyframeCurve } from "../../../../animation";
import { admitAnimationsChannel } from "../../../../animation/scalar-admission";
import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../../../base-command";
import { updateElementInSceneTracks } from "../../../../timeline";
import { resolveAnimationTarget } from "../../../../timeline/animation-targets";
import type {
	AnimationPath,
	ScalarCurveKeyframePatch,
} from "../../../../animation/types";
import type { SceneTracks } from "../../../../timeline";

export class UpdateScalarKeyframeCurveCommand extends Command {
	readonly routingClass = "transaction" as const;

	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly propertyPath: AnimationPath;
	private readonly componentKey: string;
	private readonly keyframeId: string;
	private readonly patch: ScalarCurveKeyframePatch;

	constructor({
		trackId,
		elementId,
		propertyPath,
		componentKey,
		keyframeId,
		patch,
	}: {
		trackId: string;
		elementId: string;
		propertyPath: AnimationPath;
		componentKey: string;
		keyframeId: string;
		patch: ScalarCurveKeyframePatch;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.propertyPath = propertyPath;
		this.componentKey = componentKey;
		this.keyframeId = keyframeId;
		this.patch = patch;
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			update: (element) => {
				const target = resolveAnimationTarget({ element, path: this.propertyPath });
				if (!target) {
					return element;
				}

				const animations = updateScalarKeyframeCurve({
						animations: element.animations,
						propertyPath: this.propertyPath,
						componentKey: this.componentKey,
						keyframeId: this.keyframeId,
						patch: this.patch,
				});
				const spec =
					target.numericRanges?.[
						target.channelLayout.kind === "leaf"
							? "value"
							: Object.keys(target.numericRanges)[0]
					];
				const admission = admitAnimationsChannel({
					animations,
					propertyPath: this.propertyPath,
					fallbackValue: Number(target.getBaseValue() ?? 0),
					duration: element.duration,
					spec,
				});
				if (admission.kind === "rejected") {
					throw new RangeError(admission.reason);
				}
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
