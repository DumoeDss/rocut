import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	particleDraft,
	particleRecord,
	particleFieldsDisabled,
} from "./programmatic-particle-data";

const authorFiles = [
	"particle-instanced-scene.ts",
	"particle-instanced-geometry.mjs",
	"particle-scene.ts",
];
function complete(value: unknown, source = false) {
	const record = particleRecord(value);
	return (
		!!record &&
		typeof record.id === "string" &&
		!!record.id &&
		Number.isSafeInteger(record.byteLength) &&
		(record.byteLength as number) > 0 &&
		typeof record.sha256 === "string" &&
		/^[a-f0-9]{64}$/.test(record.sha256) &&
		(source
			? record.kind === "source" &&
				record.mimeType === "application/octet-stream" &&
				record.attachmentKey === `programmatic-source-sha256-${record.sha256}`
			: record.attachmentKey === `programmatic-sha256-${record.sha256}`)
	);
}

/** Baseline archive identity, never an inferred capability from draft JSON. */
export function particleInstanceFieldsVisible({
	state,
}: {
	state: BuildDraftSnapshot;
}) {
	const source = state.baseline,
		build = source.build,
		props = particleRecord(build?.inputProps);
	return (
		!!build &&
		build.engine === "three" &&
		build.capabilities?.includes("particle-surface-v1") === true &&
		build.entryFile === authorFiles[0] &&
		build.inputs.length === authorFiles.length &&
		authorFiles.every((id) =>
			build.inputs.some((input) => input.id === id && complete(input, true)),
		) &&
		!!props &&
		Object.hasOwn(props, "instances") &&
		Array.isArray(props.instances) &&
		typeof props.modelId === "string" &&
		source.resources?.some(
			(resource) =>
				resource.id === props.modelId &&
				resource.kind === "model" &&
				resource.mimeType === "model/gltf-binary" &&
				complete(resource),
		) === true
	);
}

export interface ParticleInstanceTexts {
	instances: string;
	instanceColors?: string;
}
/** Same transition used by textarea handlers; disabled direct events are inert. */
export function changeParticleInstanceTexts({
	state,
	canCompile,
	drafts,
	key,
	next,
}: {
	state: BuildDraftSnapshot;
	canCompile: boolean;
	drafts: ParticleInstanceTexts;
	key: keyof ParticleInstanceTexts;
	next: string;
}) {
	if (
		particleFieldsDisabled({ state, canCompile }) ||
		!particleInstanceFieldsVisible({ state }) ||
		!Object.hasOwn(drafts, key)
	)
		return undefined;
	const updated = { ...drafts, [key]: next };
	return {
		drafts: updated,
		...editParticleInstanceDraft({ text: state.inputProps, drafts: updated }),
	};
}
export function particleInstanceTexts(
	text: string,
): ParticleInstanceTexts | undefined {
	const props = particleDraft(text);
	if (!props || !Object.hasOwn(props, "instances")) return undefined;
	return {
		instances: JSON.stringify(props.instances, null, 2),
		...(Object.hasOwn(props, "instanceColors")
			? { instanceColors: JSON.stringify(props.instanceColors, null, 2) }
			: {}),
	};
}
function matrices(value: unknown): value is number[][] {
	return (
		Array.isArray(value) &&
		value.length >= 1 &&
		value.length <= 64 &&
		value.every(
			(matrix) =>
				Array.isArray(matrix) &&
				matrix.length === 16 &&
				matrix.every((v) => typeof v === "number" && Number.isFinite(v)) &&
				matrix[3] === 0 &&
				matrix[7] === 0 &&
				matrix[11] === 0 &&
				matrix[15] === 1,
		)
	);
}
function colors(value: unknown, count: number) {
	return (
		Array.isArray(value) &&
		value.length === count &&
		value.every(
			(color) =>
				Array.isArray(color) &&
				color.length === 3 &&
				color.every(
					(v) =>
						typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
				),
		)
	);
}

/** Presentation shape only. Determinants, source/work budgets and sampling stay native/compiler-owned. */
export function editParticleInstanceDraft({
	text,
	drafts,
}: {
	text: string;
	drafts: ParticleInstanceTexts;
}): { inputProps?: string; error?: string; count?: number } {
	const props = particleDraft(text);
	if (!props || !Object.hasOwn(props, "instances"))
		return {
			error: "Fix complete Input props JSON first; original text is retained.",
		};
	let instances: unknown, instanceColors: unknown;
	try {
		instances = JSON.parse(drafts.instances);
	} catch {
		return { error: "Matrices must be valid JSON; local text is retained." };
	}
	if (!matrices(instances))
		return {
			error:
				"Use 1..64 explicit matrices, each 16 finite column-major numbers with affine last row [0,0,0,1].",
		};
	const hasColors = Object.hasOwn(props, "instanceColors");
	if (hasColors !== (drafts.instanceColors !== undefined))
		return {
			error:
				"Only existing instanceColors may be edited; missing colors remain omitted.",
		};
	if (hasColors) {
		try {
			instanceColors = JSON.parse(drafts.instanceColors!);
		} catch {
			return {
				error: "Colors must be valid JSON; local text is retained.",
				count: instances.length,
			};
		}
		if (!colors(instanceColors, instances.length))
			return {
				error:
					"Colors must match matrix count, each explicit linear RGB [0,1] triple (not sRGB or alpha).",
				count: instances.length,
			};
	}
	props.instances = instances;
	if (hasColors) props.instanceColors = instanceColors;
	return {
		inputProps: JSON.stringify(props, null, 2),
		count: instances.length,
	};
}
