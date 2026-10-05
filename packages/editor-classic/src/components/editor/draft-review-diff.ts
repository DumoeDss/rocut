export interface ReviewField {
	readonly path: string;
	readonly before: unknown;
	readonly after: unknown;
}

/** Presentation-only comparison; never constructs or applies an operation. */
export function changedReviewFields({
	before,
	after,
	path = "",
}: {
	before: unknown;
	after: unknown;
	path?: string;
}): ReviewField[] {
	if (JSON.stringify(before) === JSON.stringify(after)) return [];
	const object = (value: unknown): value is Record<string, unknown> =>
		typeof value === "object" && value !== null;
	if (
		!object(before) ||
		!object(after) ||
		Array.isArray(before) !== Array.isArray(after) ||
		path.endsWith(".resolvedPlan")
	) {
		return [{ path, before, after }];
	}
	const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
	return keys.flatMap((key) =>
		changedReviewFields({
			before: before[key],
			after: after[key],
			path: path ? path + "." + key : key,
		}),
	);
}
