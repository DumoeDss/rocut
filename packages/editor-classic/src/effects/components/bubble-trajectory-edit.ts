import type { ParamDefinition, ParamValues } from "../../params";

export function appendBubblePoint({
	params,
	definitions,
}: {
	params: ParamValues;
	definitions: readonly ParamDefinition[];
}): ParamValues {
	const index = Number(params.pointCount);
	const next: ParamValues = { ...params, pointCount: index + 1 };
	for (const axis of ["Time", "X", "Y"]) {
		const key = `point${index}${axis}`;
		const definition = definitions.find((param) => param.key === key);
		if (!definition)
			throw new Error("No additional trajectory point is available.");
		next[key] =
			axis === "Time"
				? Number(params[`point${index - 1}Time`]) + 1
				: (params[`point${index - 1}${axis}`] ?? definition.default);
	}
	return next;
}

export function removeBubblePoint({
	params,
	index,
}: {
	params: ParamValues;
	index: number;
}): ParamValues {
	if (index === 0)
		throw new Error("The first point anchors the activity start.");
	const count = Number(params.pointCount);
	const next: ParamValues = { ...params, pointCount: count - 1 };
	for (let slot = index; slot < count - 1; slot++) {
		for (const axis of ["Time", "X", "Y"])
			next[`point${slot}${axis}`] = params[`point${slot + 1}${axis}`];
	}
	for (const axis of ["Time", "X", "Y"])
		delete next[`point${count - 1}${axis}`];
	return next;
}
