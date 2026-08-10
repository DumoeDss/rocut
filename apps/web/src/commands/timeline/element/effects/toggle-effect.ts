/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The registered element predicate establishes the VisualElement narrowing used by the update callback. */
import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import { isVisualElement, updateElementInSceneTracks } from "@/timeline";
import type { SceneTracks, VisualElement } from "@/timeline";

export function toggleEffectOnElement({
	element,
	effectId,
}: {
	element: VisualElement;
	effectId: string;
}): VisualElement {
	const currentEffects = element.effects ?? [];
	const updated = currentEffects.map((effect) =>
		effect.id === effectId ? { ...effect, enabled: !effect.enabled } : effect,
	);
	return { ...element, effects: updated };
}

export class ToggleClipEffectCommand extends Command {
	readonly routingClass = "provider-private" as const;

	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly effectId: string;

	constructor({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.effectId = effectId;
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			elementPredicate: isVisualElement,
			update: (element) => {
				return toggleEffectOnElement({
					element: element as VisualElement,
					effectId: this.effectId,
				});
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
}
