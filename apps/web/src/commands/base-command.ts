import type { EditorSelectionPatch } from "@/selection/editor-selection";
import type { ElementRef } from "@/timeline/types";
import type { EditorCore } from "@/core";

export interface EditorCommandContext {
	readonly editor: EditorCore;
}

export interface CommandResult {
	selection?: EditorSelectionPatch;
}

export function createElementSelectionResult(
	selectedElements: ElementRef[],
): CommandResult {
	return {
		selection: {
			selectedElements,
			selectedKeyframes: [],
			keyframeSelectionAnchor: null,
			selectedMaskPoints: null,
		},
	};
}

export abstract class Command {
	abstract execute(context: EditorCommandContext): CommandResult | undefined;

	undo(_context: EditorCommandContext): void {
		throw new Error("Undo not implemented for this command");
	}

	redo(context: EditorCommandContext): CommandResult | undefined {
		return this.execute(context);
	}
}
