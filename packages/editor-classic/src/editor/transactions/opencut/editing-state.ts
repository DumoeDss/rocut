/** Serialization only. Validation and semantics are owned by the Rust editing API. */
import type { ClipEditing } from "@opencut/editor-contracts";
import type { TimelineElement } from "../../../timeline/types";
import { cloneOpaque } from "../../persistence/opaque-value";

// Native animation helpers retain optional keys with undefined values. The
// transaction wire removes them; normalize only this JSON editing payload so
// staged binding compares the same representation before and after transport.
function omitUndefined(value: unknown): void {
	if (!value || typeof value !== "object") return;
	for (const key of Object.keys(value)) {
		const child: unknown = Reflect.get(value, key);
		if (child === undefined) Reflect.deleteProperty(value, key);
		else omitUndefined(child);
	}
}

export function projectEditingState(element: TimelineElement): ClipEditing {
	const editing = cloneOpaque({
		type: element.type,
		name: element.name,
		params: element.params,
		...(element.animations !== undefined && { animations: element.animations }),
		...("hidden" in element &&
			element.hidden !== undefined && { hidden: element.hidden }),
		...("effects" in element &&
			element.effects !== undefined && { effects: element.effects }),
		...("masks" in element &&
			element.masks !== undefined && {
				masks: element.masks.map((mask) => ({
					...mask,
					params: { ...mask.params },
				})),
			}),
		...(element.type === "video" &&
			element.isSourceAudioEnabled !== undefined && {
				isSourceAudioEnabled: element.isSourceAudioEnabled,
			}),
		...(element.type === "graphic" && { definitionId: element.definitionId }),
		...(element.type === "effect" && { effectType: element.effectType }),
		...(element.type === "sticker" && {
			stickerId: element.stickerId,
			...(element.intrinsicWidth !== undefined && {
				intrinsicWidth: element.intrinsicWidth,
			}),
			...(element.intrinsicHeight !== undefined && {
				intrinsicHeight: element.intrinsicHeight,
			}),
		}),
	});
	omitUndefined(editing);
	return editing;
}

export function applyEditingState({
	element,
	editing,
}: {
	element: TimelineElement;
	editing: ClipEditing;
}): TimelineElement {
	// A complete editing object replaces the exposed state. Absent optional
	// collections mean none, so deletion survives serialization and history.
	const next = { ...element };
	for (const field of [
		"animations",
		"effects",
		"masks",
		"hidden",
		"isSourceAudioEnabled",
		"definitionId",
		"stickerId",
		"intrinsicWidth",
		"intrinsicHeight",
		"effectType",
	] as const) {
		Reflect.deleteProperty(next, field);
	}
	// This cast bridges readonly contract arrays and the native mutable model;
	// the independent clone is owned solely by the candidate transaction.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Rust validates the discriminant and nested schema before this readonly/native bridge.
	return { ...next, ...cloneOpaque(editing) } as unknown as TimelineElement;
}
