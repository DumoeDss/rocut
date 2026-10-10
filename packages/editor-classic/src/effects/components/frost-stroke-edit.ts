import type { ParamDefinition, ParamValue, ParamValues } from "../../params";

export function frostTypedValue({ input }: { input: string }): ParamValue {
	const number = Number(input);
	return input.trim() !== "" && Number.isFinite(number) ? number : input;
}

export const FROST_STROKE_FIELDS = [
	"TimeTicks",
	"FromX",
	"FromY",
	"ToX",
	"ToY",
	"Radius",
	"Strength",
] as const;

export function frostStrokeState({
	params,
	definitions,
}: {
	params: ParamValues;
	definitions: readonly ParamDefinition[];
}) {
	const descriptor = definitions.find((param) => param.key === "strokeCount");
	const count = params.strokeCount;
	if (
		descriptor?.type !== "number" ||
		descriptor.max === undefined ||
		!Number.isSafeInteger(count) ||
		typeof count !== "number" ||
		count < descriptor.min ||
		count > descriptor.max
	) {
		return {
			count: 0,
			maximum: 0,
			issue: "Invalid stroke count. The draft has not been changed.",
		};
	}
	for (const key of Object.keys(params)) {
		const match =
			/^stroke(\d+)(?:TimeTicks|FromX|FromY|ToX|ToY|Radius|Strength)$/.exec(
				key,
			);
		if (match && Number(match[1]) >= count)
			return {
				count,
				maximum: descriptor.max,
				issue:
					"Inactive stroke fields are present. The draft has not been changed.",
			};
	}
	for (let index = 0; index < count; index++) {
		for (const field of FROST_STROKE_FIELDS) {
			const key = `stroke${index}${field}`;
			if (
				!Object.hasOwn(params, key) ||
				params[key] === undefined ||
				!definitions.some(
					(param) => param.key === key && param.type === "number",
				)
			)
				return {
					count,
					maximum: descriptor.max,
					issue: `Stroke ${index + 1} is incomplete. The draft has not been changed.`,
				};
		}
	}
	return { count, maximum: descriptor.max, issue: "" };
}

export function appendFrostStroke({
	params,
	definitions,
}: {
	params: ParamValues;
	definitions: readonly ParamDefinition[];
}): ParamValues {
	const { count, maximum, issue } = frostStrokeState({ params, definitions });
	if (issue) throw new Error(issue);
	if (count >= maximum)
		throw new Error("No additional melt stroke is available.");
	const next: ParamValues = { ...params, strokeCount: count + 1 };
	for (const field of FROST_STROKE_FIELDS) {
		const key = `stroke${count}${field}`;
		const descriptor = definitions.find((param) => param.key === key);
		if (descriptor?.type !== "number")
			throw new Error("The stroke catalog is incomplete.");
		next[key] = descriptor.default;
	}
	return next;
}

export function removeFrostStroke({
	params,
	definitions,
	index,
}: {
	params: ParamValues;
	definitions: readonly ParamDefinition[];
	index: number;
}): ParamValues {
	const { count, issue } = frostStrokeState({ params, definitions });
	if (issue) throw new Error(issue);
	if (!Number.isSafeInteger(index) || index < 0 || index >= count)
		throw new Error("No melt stroke exists at that index.");
	const next: ParamValues = { ...params, strokeCount: count - 1 };
	for (let slot = index; slot < count - 1; slot++)
		for (const field of FROST_STROKE_FIELDS)
			next[`stroke${slot}${field}`] = params[`stroke${slot + 1}${field}`];
	for (const field of FROST_STROKE_FIELDS)
		delete next[`stroke${count - 1}${field}`];
	return next;
}

export function frostFieldGroups({
	definitions,
}: {
	definitions: readonly ParamDefinition[];
}) {
	const fields = definitions.filter(
		(param) => !/^stroke(?:Count|\d+)/.test(param.key),
	);
	return [
		{
			label: "Optics",
			params: fields.filter((param) => param.keyframable === true),
		},
		{
			label: "Recovery",
			params: fields.filter((param) => param.keyframable !== true),
		},
	];
}
