import { hasKeyframesForPath, removeElementKeyframe } from "../../../../animation";
import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../../../base-command";
import { updateElementInSceneTracks } from "../../../../timeline";
import type { AnimationPath } from "../../../../animation/types";
import type { ParamValue } from "../../../../params";
import type { SceneTracks, TimelineElement } from "../../../../timeline";
import { resolveAnimationTarget } from "../../../../timeline/animation-targets";

function removeKeyframeAndPersist({
	element,
	propertyPath,
	keyframeId,
	valueAtPlayhead,
}: {
	element: TimelineElement;
	propertyPath: AnimationPath;
	keyframeId: string;
	valueAtPlayhead: ParamValue | null;
}): TimelineElement {
	const target = resolveAnimationTarget({ element, path: propertyPath });
	if (!target) {
		return element;
	}

	const nextAnimations = removeElementKeyframe({
		animations: element.animations,
		propertyPath,
		keyframeId,
	});

	const isChannelNowEmpty = !hasKeyframesForPath({
		animations: nextAnimations,
		propertyPath,
	});

	// When clearing all keyframes, preserve the value at the playhead (what the user was seeing)
	const shouldPersistToBase = isChannelNowEmpty && valueAtPlayhead !== null;

	const baseElement = shouldPersistToBase
		? target.setBaseValue({ value: valueAtPlayhead })
		: element;

	return { ...baseElement, animations: nextAnimations };
}

export class RemoveKeyframeCommand extends Command {
	readonly routingClass = "provider-private" as const;

	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly propertyPath: AnimationPath;
	private readonly keyframeId: string;
	private readonly valueAtPlayhead: ParamValue | null;

	constructor({
		trackId,
		elementId,
		propertyPath,
		keyframeId,
		valueAtPlayhead,
	}: {
		trackId: string;
		elementId: string;
		propertyPath: AnimationPath;
		keyframeId: string;
		valueAtPlayhead: ParamValue | null;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.propertyPath = propertyPath;
		this.keyframeId = keyframeId;
		this.valueAtPlayhead = valueAtPlayhead;
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			update: (element) =>
				removeKeyframeAndPersist({
					element,
					propertyPath: this.propertyPath,
					keyframeId: this.keyframeId,
					valueAtPlayhead: this.valueAtPlayhead,
				}),
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
