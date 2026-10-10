import type {
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, item]) => [name, canonical(item)]),
		);
	return value;
}
function descriptorKey(resource: ProgrammaticResource): string {
	// Rust serializes default physical-font axes by omitting the empty map.
	// Normalize only that equivalent spelling, retaining every other field.
	if (
		resource.font?.axes &&
		typeof resource.font.axes === "object" &&
		(Object.getPrototypeOf(resource.font.axes) === Object.prototype ||
			Object.getPrototypeOf(resource.font.axes) === null) &&
		Object.keys(resource.font.axes).length === 0
	) {
		const { axes: _axes, ...font } = resource.font;
		return JSON.stringify(canonical({ ...resource, font }));
	}
	return JSON.stringify(canonical(resource));
}

export function readJzNativeBytes({
	resources,
	resource,
	signal,
}: {
	resources: readonly ResolvedProgrammaticResource[];
	resource: ProgrammaticResource;
	signal?: AbortSignal;
}): Uint8Array {
	signal?.throwIfAborted();
	const expected = descriptorKey(resource);
	const selected = resources.filter(
		(item) => descriptorKey(item.resource) === expected,
	);
	if (
		selected.length !== 1 ||
		!(selected[0]!.body instanceof ArrayBuffer) ||
		selected[0]!.body.byteLength !== resource.byteLength
	)
		throw Error("JIZURA exact binary descriptor unavailable");
	return new Uint8Array(selected[0]!.body);
}
