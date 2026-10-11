import type { BuildDraftSnapshot } from "./programmatic-build-draft";

export const particleFieldsVisible = (state: BuildDraftSnapshot) =>
	state.baseline.build?.engine === "three" &&
	state.baseline.build.capabilities?.includes("particle-surface-v1") === true;

export const particleFieldsDisabled = ({
	state,
	canCompile,
}: {
	state: BuildDraftSnapshot;
	canCompile: boolean;
}) => !!state.phase || state.conflict || !canCompile;

const finiteJson = (entry: unknown): boolean =>
	entry === null || typeof entry === "string" || typeof entry === "boolean"
		? true
		: typeof entry === "number"
			? Number.isFinite(entry)
			: !!entry && typeof entry === "object"
				? Object.values(entry).every(finiteJson)
				: false;

export function particleRecord(
	value: unknown,
): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** JSON presentation only. Do not turn overflowing JSON numbers into null. */
export function particleDraft(
	text: string,
): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return finiteJson(value) ? particleRecord(value) : undefined;
	} catch {
		return undefined;
	}
}

/** Change an existing path only; keep all unknown author properties. */
export function editParticleDraft({
	text,
	path,
	next,
}: {
	text: string;
	path: readonly (string | number)[];
	next: unknown;
}): string | undefined {
	const root = particleDraft(text);
	if (!root || !path.length || !finiteJson(next)) return undefined;
	let parent: unknown = root;
	for (const key of path.slice(0, -1)) {
		if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
			return undefined;
		parent = (parent as Record<string | number, unknown>)[key];
	}
	const key = path[path.length - 1];
	if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
		return undefined;
	(parent as Record<string | number, unknown>)[key] = next;
	const output = JSON.stringify(root, null, 2);
	return particleDraft(output) ? output : undefined;
}
