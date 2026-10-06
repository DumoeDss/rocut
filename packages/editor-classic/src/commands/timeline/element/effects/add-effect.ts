/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The registered element predicate establishes the VisualElement narrowing used by the update callback. */
import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../../../base-command";
import {
	isVisualElement,
	updateElementInSceneTracks,
} from "../../../../timeline";
import type { SceneTracks, VisualElement } from "../../../../timeline";
import { buildDefaultEffectInstance } from "../../../../effects";

function addEffectToElement({
	element,
	instance,
}: {
	element: VisualElement;
	instance: ReturnType<typeof buildDefaultEffectInstance>;
}): VisualElement {
	const currentEffects = element.effects ?? [];
	return { ...element, effects: [...currentEffects, instance] };
}

export class AddClipEffectCommand extends Command {
	readonly routingClass = "transaction" as const;

	private savedState: SceneTracks | null = null;
	private readonly instance: ReturnType<typeof buildDefaultEffectInstance>;
	private readonly trackId: string;
	private readonly elementId: string;

	constructor({
		trackId,
		elementId,
		effectType,
	}: {
		trackId: string;
		elementId: string;
		effectType: string;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.instance = buildDefaultEffectInstance({ effectType });
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			elementPredicate: isVisualElement,
			update: (element) => {
				const updated = addEffectToElement({
					element: element as VisualElement,
					instance: this.instance,
				});
				return updated;
			},
		});

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedState) {
			editor.timeline.updateTracks(this.savedState);
		}
	}

	getEffectId(): string | null {
		return this.instance.id;
	}
}
