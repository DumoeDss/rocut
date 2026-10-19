import type {
	TimelineElement,
	TimelineTrack,
} from "../../../../timeline/types";
import type { NumberParamDefinition } from "../../../../params";
import { coerceParamValue } from "../../../../params";
import {
	getElementParams,
	readElementParamValue,
} from "../../../../params/registry";

export function buildCommonPropertyUpdates({
	selected,
	param,
	raw,
}: {
	selected: readonly { element: TimelineElement; track: TimelineTrack }[];
	param: NumberParamDefinition;
	raw: string;
}) {
	if (
		!raw.trim() ||
		!Number.isFinite(Number(raw)) ||
		selected.some(
			({ element, track }) =>
				track.locked ||
				!getElementParams({ element }).some(
					(candidate) => candidate.key === param.key,
				) ||
				Object.entries(element.animations ?? {}).some(
					([key, channel]) =>
						channel !== undefined &&
						(key === param.key || key === `params.${param.key}`),
				),
		)
	)
		return [];
	const value = coerceParamValue({ param, value: Number(raw) });
	if (value === null) return [];
	return selected
		.filter(
			({ element }) => readElementParamValue({ element, param }) !== value,
		)
		.map(({ element, track }) => ({
			trackId: track.id,
			elementId: element.id,
			patch: { params: { ...element.params, [param.key]: value } },
		}));
}
