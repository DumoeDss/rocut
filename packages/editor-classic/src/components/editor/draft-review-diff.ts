export interface ReviewField {
	readonly path: string;
	readonly before: unknown;
	readonly after: unknown;
}

/** Human labels are presentation only; raw paths remain available for inspection. */
export function reviewFieldLabel(path: string): string {
	const labels: Record<string, string> = {
		motionTextSequences: "Motion text",
		cues: "Cue",
		overrides: "Local settings",
		colors: "Colors",
		foreground: "Text color",
		accent: "Accent color",
		resolvedPlan: "Render plan",
		text: "Text",
		segments: "Text segments",
		startTime: "Start time",
		duration: "Duration",
		revision: "Revision",
		id: "ID",
	};
	return path
		.split(".")
		.map((part) =>
			/^\d+$/.test(part)
				? String(Number(part) + 1)
				: (labels[part] ?? part.replace(/([a-z])([A-Z])/g, "$1 $2")),
		)
		.join(" / ");
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
