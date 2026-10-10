import type { ParamDefinition, ParamValue, ParamValues } from "../../params";

export const CANVAS_STROKE_FIELDS = [
	"StartTicks",
	"EndTicks",
	"FromX",
	"FromY",
	"ToX",
	"ToY",
	"Radius",
	"Bristles",
	"Opacity",
	"Wetness",
	"Thickness",
] as const;
const slotPattern = /^stroke\d+/;

export function canvasTypedValue({ input }: { input: string }): ParamValue {
	const value = Number(input);
	return input.trim() && Number.isFinite(value) ? value : input;
}

export function canvasStrokeState({
	params,
	definitions,
}: {
	params: ParamValues;
	definitions: readonly ParamDefinition[];
}) {
	const descriptor = definitions.find((param) => param.key === "strokeCount");
	const count = params.strokeCount;
	const maximum = descriptor?.type === "number" ? (descriptor.max ?? 0) : 0;
	if (
		typeof count !== "number" ||
		!Number.isSafeInteger(count) ||
		count < 0 ||
		count > maximum
	)
		return {
			count: 0,
			maximum,
			issue:
				"Invalid trajectory count. Clear trajectories to start a new schedule.",
		};
	const active = new Set(
		Array.from({ length: count }, (_, index) =>
			CANVAS_STROKE_FIELDS.map((field) => `stroke${index}${field}`),
		).flat(),
	);
	if (
		Object.keys(params).some((key) => slotPattern.test(key) && !active.has(key))
	)
		return {
			count,
			maximum,
			issue:
				"Inactive or unknown trajectory fields are present. Clear trajectories to start a new schedule.",
		};
	return { count, maximum, issue: "" };
}

export function clearCanvasStrokes({
	params,
}: {
	params: ParamValues;
}): ParamValues {
	return Object.fromEntries(
		Object.entries({ ...params, strokeCount: 0 }).filter(
			([key]) => !slotPattern.test(key),
		),
	);
}

export function appendCanvasStroke({
	params,
	definitions,
}: {
	params: ParamValues;
	definitions: readonly ParamDefinition[];
}): ParamValues {
	const { count, maximum, issue } = canvasStrokeState({ params, definitions });
	if (issue) throw new Error(issue);
	if (count >= maximum)
		throw new Error("No additional trajectory is available.");
	const next: ParamValues = { ...params, strokeCount: count + 1 };
	for (const field of CANVAS_STROKE_FIELDS) {
		const key = `stroke${count}${field}`;
		const descriptor = definitions.find((param) => param.key === key);
		if (descriptor?.type !== "number")
			throw new Error("The trajectory catalog is incomplete.");
		next[key] = descriptor.default;
	}
	return next;
}

export function removeCanvasStroke({
	params,
	definitions,
	index,
}: {
	params: ParamValues;
	definitions: readonly ParamDefinition[];
	index: number;
}): ParamValues {
	const { count, issue } = canvasStrokeState({ params, definitions });
	if (issue) throw new Error(issue);
	if (!Number.isSafeInteger(index) || index < 0 || index >= count)
		throw new Error("No trajectory exists at that index.");
	const next: ParamValues = { ...params, strokeCount: count - 1 };
	for (let slot = index; slot < count - 1; slot++) {
		for (const field of CANVAS_STROKE_FIELDS) {
			const key = `stroke${slot}${field}`;
			const source = `stroke${slot + 1}${field}`;
			if (Object.hasOwn(params, source)) next[key] = params[source];
			else delete next[key];
		}
	}
	for (const field of CANVAS_STROKE_FIELDS)
		delete next[`stroke${count - 1}${field}`];
	return next;
}

export function canvasFieldGroups({
	definitions,
}: {
	definitions: readonly ParamDefinition[];
}) {
	const fields = definitions.filter(
		(param) => !/^stroke(?:Count|\d+)/.test(param.key),
	);
	const lighting = new Set(["lightX", "lightY", "lightZ", "relief"]);
	return [
		{
			label: "Material",
			params: fields.filter((param) => !lighting.has(param.key)),
		},
		{
			label: "Lighting",
			params: fields.filter((param) => lighting.has(param.key)),
		},
	];
}
