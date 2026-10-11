import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	editParticleDraft,
	particleDraft,
	particleRecord,
} from "./programmatic-particle-data";

export type ObjectParameterKind = "glass" | "ink" | "liquid";
type Field = { key: string; type: "number" | "boolean" | "rgb" };
/** Public transport fields only: no defaults, ranges, physical or clock policy. */
export const OBJECT_PARAMETER_FIELDS: Record<
	ObjectParameterKind,
	readonly Field[]
> = {
	glass: [
		{ key: "transmission", type: "number" },
		{ key: "ior", type: "number" },
		{ key: "thickness", type: "number" },
		{ key: "roughness", type: "number" },
		{ key: "dispersion", type: "number" },
		{ key: "attenuationDistance", type: "number" },
		{ key: "environmentIntensity", type: "number" },
		{ key: "color", type: "rgb" },
	],
	ink: [
		{ key: "contourWidth", type: "number" },
		{ key: "inkDensity", type: "number" },
		{ key: "paperTexture", type: "number" },
		{ key: "paperScale", type: "number" },
		{ key: "inkColor", type: "rgb" },
		{ key: "paperColor", type: "rgb" },
	],
	liquid: [
		{ key: "enabled", type: "boolean" },
		{ key: "amount", type: "number" },
		{ key: "frequency", type: "number" },
		{ key: "speed", type: "number" },
		{ key: "twist", type: "number" },
	],
};

/** Identify the fixed archived helper scenes, never arbitrary Three author code. */
export function objectParameterKind({
	state,
}: {
	state: BuildDraftSnapshot;
}): ObjectParameterKind | undefined {
	const source = state.baseline,
		build = source.build,
		props = particleRecord(build?.inputProps);
	if (
		build?.engine !== "three" ||
		!props ||
		typeof props.modelId !== "string" ||
		!props.modelId
	)
		return undefined;
	const archived = ({ id }: { id: string }) =>
		build.inputs.some((input) => input.id === id);
	if (!archived({ id: build.entryFile })) return undefined;
	const resource = source.resources?.find(
		(item) => item.id === props.modelId && item.kind === "model",
	);
	if (!resource) return undefined;
	if (props.assetKind === "svg") {
		if (resource.mimeType !== "image/svg+xml" || !particleRecord(props.shape))
			return undefined;
	} else if (
		(props.assetKind !== undefined && props.assetKind !== "model") ||
		resource.mimeType !== "model/gltf-binary"
	)
		return undefined;
	let kind: ObjectParameterKind;
	if (build.entryFile === "glass-object-scene.ts") kind = "glass";
	else if (build.entryFile === "ink-object-scene.ts") kind = "ink";
	else if (
		build.entryFile === "liquid-object-scene.ts" ||
		build.entryFile === "liquid-animated-scene.ts"
	) {
		kind = "liquid";
		if (
			!build.capabilities?.includes("liquid-object-v1") ||
			!archived({ id: "liquid-object-geometry.mjs" })
		)
			return undefined;
		if (
			build.entryFile === "liquid-animated-scene.ts" &&
			(resource.mimeType !== "model/gltf-binary" ||
				!particleRecord(props.animation) ||
				!archived({ id: "object-animation.mjs" }) ||
				!archived({ id: "particle-pose-geometry.mjs" }))
		)
			return undefined;
	} else return undefined;
	return particleRecord(props[kind])?.version === 1 ? kind : undefined;
}

export function objectParameterDraft({
	text,
	kind,
}: {
	text: string;
	kind: ObjectParameterKind;
}) {
	return particleRecord(particleDraft(text)?.[kind]);
}

export function objectParameterValueValid({
	field,
	value,
}: {
	field: Field;
	value: unknown;
}): boolean {
	return field.type === "number"
		? typeof value === "number" && Number.isFinite(value)
		: field.type === "boolean"
			? typeof value === "boolean"
			: typeof value === "string";
}

/** Only replace existing public paths; keep unknown author data and missing values. */
export function editObjectParameterDraft({
	text,
	kind,
	key,
	next,
}: {
	text: string;
	kind: ObjectParameterKind;
	key: string;
	next: unknown;
}): string | undefined {
	const field = OBJECT_PARAMETER_FIELDS[kind].find((item) => item.key === key);
	if (
		!field ||
		!objectParameterValueValid({ field, value: next }) ||
		!objectParameterDraft({ text, kind })
	)
		return undefined;
	return editParticleDraft({ text, path: [kind, key], next });
}
