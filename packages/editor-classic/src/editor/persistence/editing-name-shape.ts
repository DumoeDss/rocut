import type { TimelineElement } from "../../timeline/types";

// Reserved serialization metadata, never part of the public editing DTO.
export const EDITING_NAME_SHAPE_KEY = "__opencutEditingNameShape";

export function omittedEditingName({
	element,
}: {
	element: TimelineElement;
}): boolean {
	const marker: unknown = Reflect.get(element, EDITING_NAME_SHAPE_KEY);
	if (!marker || typeof marker !== "object" || Array.isArray(marker))
		return false;
	const keys = Object.keys(marker);
	return (
		keys.length === 4 &&
		keys.every((key) =>
			["version", "elementId", "elementType", "donorName"].includes(key),
		) &&
		Reflect.get(marker, "version") === 1 &&
		typeof Reflect.get(marker, "elementId") === "string" &&
		typeof Reflect.get(marker, "elementType") === "string" &&
		typeof Reflect.get(marker, "donorName") === "string" &&
		Reflect.get(marker, "elementId") === element.id &&
		Reflect.get(marker, "elementType") === element.type &&
		Reflect.get(marker, "donorName") === element.name
	);
}

export function editingNameOmissionMarker({
	element,
}: {
	element: TimelineElement;
}) {
	return {
		version: 1,
		elementId: element.id,
		elementType: element.type,
		donorName: element.name,
	};
}
