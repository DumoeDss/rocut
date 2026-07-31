import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import { isMaskableElement, updateElementInSceneTracks } from "@/timeline";
import type { SceneTracks, MaskableElement } from "@/timeline";

function removeMaskFromElement({
	element,
	maskId,
}: {
	element: MaskableElement;
	maskId: string;
}): MaskableElement {
	const currentMasks = element.masks ?? [];
	const filteredMasks = currentMasks.filter((mask) => mask.id !== maskId);
	return { ...element, masks: filteredMasks };
}

export class RemoveMaskCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly maskId: string;

	constructor({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.maskId = maskId;
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			elementPredicate: isMaskableElement,
			update: (element) => {
				if (!isMaskableElement(element)) return element;
				return removeMaskFromElement({
					element,
					maskId: this.maskId,
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
