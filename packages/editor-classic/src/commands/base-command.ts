import type { EditorSelectionPatch } from "../selection/editor-selection";
import type { ElementRef } from "../timeline/types";
import type { EditorCore } from "../core";

export const COMMAND_ROUTING_CLASSES = [
	"transaction",
	"preview",
	"provider-private",
	"immediate",
] as const;

export type CommandRoutingClass = (typeof COMMAND_ROUTING_CLASSES)[number];

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
	abstract readonly routingClass: CommandRoutingClass;

	abstract execute(context: EditorCommandContext): CommandResult | undefined;

	undo(_context: EditorCommandContext): void {
		throw new Error("Undo not implemented for this command");
	}

	redo(context: EditorCommandContext): CommandResult | undefined {
		return this.execute(context);
	}
}
