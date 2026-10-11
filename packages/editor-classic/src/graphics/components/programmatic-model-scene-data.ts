import { isProgrammaticResource } from "@opencut/editor-contracts";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	editParticleDraft,
	particleDraft,
	particleRecord,
	particleFieldsDisabled,
} from "./programmatic-particle-data";

export type ModelSceneField = {
	path: readonly string[];
	label: string;
	group: "Camera" | "Model transform" | "Scene/environment";
	type: "number" | "vector" | "hex" | "boolean";
};
const camera: ModelSceneField[] = [
	{
		path: ["camera", "position"],
		label: "Camera position [x,y,z]",
		group: "Camera",
		type: "vector",
	},
	{
		path: ["camera", "target"],
		label: "Camera target [x,y,z]",
		group: "Camera",
		type: "vector",
	},
	...["fov", "near", "far"].map((key) => ({
		path: ["camera", key],
		label: key === "fov" ? "Field of view (degrees)" : `Camera ${key}`,
		group: "Camera" as const,
		type: "number" as const,
	})),
];
const transform: ModelSceneField[] = [
	{
		path: ["scale"],
		label: "Model scale",
		group: "Model transform",
		type: "number",
	},
	{
		path: ["position"],
		label: "Model position [x,y,z]",
		group: "Model transform",
		type: "vector",
	},
	{
		path: ["rotation"],
		label: "Model rotation [x,y,z] (radians)",
		group: "Model transform",
		type: "vector",
	},
	{
		path: ["rotationSpeed"],
		label: "Rotation speed [x,y,z] (radians/second)",
		group: "Model transform",
		type: "vector",
	},
];
const background: ModelSceneField = {
	path: ["backgroundColor"],
	label: "Background color (#RRGGBB)",
	group: "Scene/environment",
	type: "hex",
};
const closures: Record<
	string,
	{
		files: string[];
		capability?: string;
		kind: "model" | "particle" | "glass" | "ink" | "liquid";
	}
> = {
	"model-feature-scene.ts": {
		files: ["model-feature-scene.ts"],
		kind: "model",
	},
	"glass-object-scene.ts": { files: ["glass-object-scene.ts"], kind: "glass" },
	"ink-object-scene.ts": { files: ["ink-object-scene.ts"], kind: "ink" },
	"particle-scene.ts": {
		files: ["particle-scene.ts"],
		capability: "particle-surface-v1",
		kind: "particle",
	},
	"particle-image-scene.ts": {
		files: ["particle-image-scene.ts"],
		capability: "particle-surface-v1",
		kind: "particle",
	},
	"particle-animated-scene.ts": {
		files: [
			"particle-animated-scene.ts",
			"particle-pose-geometry.mjs",
			"particle-scene.ts",
			"object-animation.mjs",
		],
		capability: "particle-surface-v1",
		kind: "particle",
	},
	"particle-instanced-scene.ts": {
		files: [
			"particle-instanced-scene.ts",
			"particle-instanced-geometry.mjs",
			"particle-scene.ts",
		],
		capability: "particle-surface-v1",
		kind: "particle",
	},
	"liquid-object-scene.ts": {
		files: ["liquid-object-scene.ts", "liquid-object-geometry.mjs"],
		capability: "liquid-object-v1",
		kind: "liquid",
	},
	"liquid-animated-scene.ts": {
		files: [
			"liquid-animated-scene.ts",
			"liquid-object-geometry.mjs",
			"particle-pose-geometry.mjs",
			"object-animation.mjs",
		],
		capability: "liquid-object-v1",
		kind: "liquid",
	},
};
function complete(value: unknown, source = false) {
	const v = particleRecord(value);
	return (
		isProgrammaticResource(value) &&
		!!v &&
		typeof v.id === "string" &&
		!!v.id &&
		Number.isSafeInteger(v.byteLength) &&
		(v.byteLength as number) > 0 &&
		typeof v.sha256 === "string" &&
		/^[a-f0-9]{64}$/.test(v.sha256) &&
		(source
			? v.kind === "source" &&
				v.mimeType === "application/octet-stream" &&
				v.attachmentKey === `programmatic-source-sha256-${v.sha256}`
			: v.attachmentKey === `programmatic-sha256-${v.sha256}`)
	);
}

export type ModelSceneResourceField = {
	key: "modelId" | "environmentId" | "backgroundId";
	label: string;
	clearable: boolean;
	choices: readonly { id: string; mimeType: string }[];
};
/** Resource selection presentation only: fixed scene closure, no import or kind conversion. */
export function modelSceneResourceFields(
	state: BuildDraftSnapshot,
): readonly ModelSceneResourceField[] {
	const build = state.baseline.build,
		props = particleRecord(build?.inputProps);
	if (build?.engine !== "three" || !props) return [];
	const rule = closures[build.entryFile];
	if (
		!rule ||
		build.entryFile === "particle-image-scene.ts" ||
		(rule.capability &&
			!build.capabilities?.includes(
				rule.capability as "particle-surface-v1" | "liquid-object-v1",
			)) ||
		!rule.files.every(
			(id) =>
				build.inputs.filter((input) => input.id === id && complete(input, true))
					.length === 1,
		)
	)
		return [];
	const svg = props.assetKind === "svg";
	if (
		(props.assetKind !== undefined && props.assetKind !== "model" && !svg) ||
		(rule.kind === "model" && props.assetKind === undefined) ||
		(svg &&
			(!particleRecord(props.shape) || build.entryFile.includes("animated")))
	)
		return [];
	const resources = state.baseline.resources ?? [];
	const choices = (kind: string, mimes: readonly string[]) =>
		resources
			.filter(
				(r) =>
					complete(r) &&
					r.kind === kind &&
					mimes.includes(r.mimeType) &&
					resources.filter((other) => other.id === r.id).length === 1,
			)
			.map(({ id, mimeType }) => ({ id, mimeType }));
	const fields: ModelSceneResourceField[] = [
		{
			key: "modelId",
			label: svg ? "Archived SVG model" : "Archived GLB model",
			clearable: false,
			choices: choices("model", [svg ? "image/svg+xml" : "model/gltf-binary"]),
		},
	];
	if (["model", "glass", "ink"].includes(rule.kind))
		fields.push({
			key: "environmentId",
			label: "Archived HDR/EXR environment",
			clearable: true,
			choices: choices("environment", ["image/vnd.radiance", "image/x-exr"]),
		});
	if (rule.kind === "glass")
		fields.push({
			key: "backgroundId",
			label: "Archived background image",
			clearable: true,
			choices: choices("image", ["image/png", "image/jpeg", "image/webp"]),
		});
	return fields;
}
export function selectModelSceneResource({
	state,
	canCompile,
	key,
	next,
}: {
	state: BuildDraftSnapshot;
	canCompile: boolean;
	key: ModelSceneResourceField["key"];
	next: string;
}): string | undefined {
	if (particleFieldsDisabled({ state, canCompile })) return undefined;
	const field = modelSceneResourceFields(state).find(
			(item) => item.key === key,
		),
		props = particleDraft(state.inputProps),
		baseline = particleRecord(state.baseline.build?.inputProps);
	if (
		!field ||
		!props ||
		!baseline ||
		props.assetKind !== baseline.assetKind ||
		(next === ""
			? !field.clearable
			: !field.choices.some((choice) => choice.id === next))
	)
		return undefined;
	if (next === "") delete props[key];
	else props[key] = next;
	return JSON.stringify(props, null, 2);
}
function existing(root: Record<string, unknown>, path: readonly string[]) {
	let value: unknown = root;
	for (const key of path) {
		const parent = particleRecord(value);
		if (!parent || !Object.hasOwn(parent, key)) return undefined;
		value = parent[key];
	}
	return { value };
}
export const modelSceneFieldKey = (field: ModelSceneField) =>
	field.path.join(".");

/** Fixed author closure and actual resources only; arbitrary Three shaders do not gain fields. */
export function modelSceneFields({
	state,
}: {
	state: BuildDraftSnapshot;
}): readonly ModelSceneField[] {
	const source = state.baseline,
		build = source.build,
		props = particleRecord(build?.inputProps);
	if (!build || build.engine !== "three" || !props) return [];
	const rule = closures[build.entryFile];
	if (
		!rule ||
		(rule.capability &&
			!build.capabilities?.includes(
				rule.capability as "particle-surface-v1" | "liquid-object-v1",
			)) ||
		!rule.files.every((id) =>
			build.inputs.some((input) => input.id === id && complete(input, true)),
		)
	)
		return [];
	const image = build.entryFile === "particle-image-scene.ts",
		id = image ? props.imageId : props.modelId;
	const resource = source.resources?.find((r) => r.id === id && complete(r));
	if (
		!resource ||
		(image
			? resource.kind !== "image" ||
				!["image/png", "image/jpeg", "image/webp"].includes(resource.mimeType)
			: resource.kind !== "model" ||
				(props.assetKind === "svg"
					? resource.mimeType !== "image/svg+xml" ||
						!particleRecord(props.shape)
					: (props.assetKind !== undefined && props.assetKind !== "model") ||
						resource.mimeType !== "model/gltf-binary"))
	)
		return [];
	if (
		rule.kind === "model" &&
		props.assetKind !== "model" &&
		props.assetKind !== "svg"
	)
		return [];
	if (
		build.entryFile === "particle-instanced-scene.ts" &&
		!Array.isArray(props.instances)
	)
		return [];
	if (
		(build.entryFile === "particle-animated-scene.ts" ||
			build.entryFile === "liquid-animated-scene.ts") &&
		!particleRecord(props.animation)
	)
		return [];
	let fields: ModelSceneField[] =
		rule.kind === "liquid" ? [background] : [...camera, ...transform];
	if (rule.kind === "particle")
		fields = fields.filter(
			(f) =>
				!["scale", "position", "rotationSpeed"].includes(modelSceneFieldKey(f)),
		);
	if (rule.kind === "model" || rule.kind === "glass") fields.push(background);
	if (
		rule.kind === "model" &&
		source.resources?.some(
			(r) =>
				r.id === props.environmentId &&
				r.kind === "environment" &&
				["image/vnd.radiance", "image/x-exr"].includes(r.mimeType) &&
				complete(r),
		)
	)
		fields.push(
			{
				path: ["intensity"],
				label: "Environment intensity",
				group: "Scene/environment",
				type: "number",
			},
			{
				path: ["environmentBackground"],
				label: "Environment as background",
				group: "Scene/environment",
				type: "boolean",
			},
		);
	return fields.filter((f) => existing(props, f.path));
}
export type ModelSceneTexts = Record<string, string>;
export function modelSceneTexts({
	state,
}: {
	state: BuildDraftSnapshot;
}): ModelSceneTexts | undefined {
	const props = particleDraft(state.inputProps);
	if (!props) return undefined;
	return Object.fromEntries(
		modelSceneFields({ state }).flatMap((field) => {
			const item = existing(props, field.path);
			if (!item) return [];
			return [
				[
					modelSceneFieldKey(field),
					field.type === "hex" && typeof item.value === "string"
						? item.value
						: JSON.stringify(item.value),
				],
			];
		}),
	);
}
export function editModelSceneDraft({
	state,
	texts,
}: {
	state: BuildDraftSnapshot;
	texts: ModelSceneTexts;
}): { inputProps?: string; error?: string } {
	const props = particleDraft(state.inputProps);
	if (!props)
		return {
			error:
				"Fix complete Input props JSON first. Your original text is retained.",
		};
	let text = state.inputProps;
	for (const field of modelSceneFields({ state })) {
		const key = modelSceneFieldKey(field);
		if (!existing(props, field.path)) continue;
		const raw = texts[key];
		let value: unknown;
		if (raw === undefined || !raw.trim())
			return {
				error: `${field.label}: enter an explicit value; local text is retained.`,
			};
		if (field.type === "hex") value = raw;
		else {
			try {
				value = JSON.parse(raw);
			} catch {
				return {
					error: `${field.label}: enter valid JSON; local text is retained.`,
				};
			}
		}
		const valid =
			field.type === "number"
				? typeof value === "number" && Number.isFinite(value)
				: field.type === "boolean"
					? typeof value === "boolean"
					: field.type === "hex"
						? typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value)
						: Array.isArray(value) &&
							value.length === 3 &&
							value.every((v) => typeof v === "number" && Number.isFinite(v));
		if (!valid)
			return {
				error: `${field.label}: use ${field.type === "vector" ? "three finite numbers [x,y,z]" : field.type === "number" ? "a finite number" : field.type === "hex" ? "#RRGGBB" : "true or false"}; local text is retained.`,
			};
		const updated = editParticleDraft({ text, path: field.path, next: value });
		if (updated === undefined)
			return { error: "Only existing declared fields can be edited." };
		text = updated;
	}
	return { inputProps: text };
}
export function changeModelSceneText({
	state,
	canCompile,
	texts,
	key,
	next,
}: {
	state: BuildDraftSnapshot;
	canCompile: boolean;
	texts: ModelSceneTexts;
	key: string;
	next: string;
}) {
	if (
		particleFieldsDisabled({ state, canCompile }) ||
		!Object.hasOwn(texts, key) ||
		!modelSceneFields({ state }).some((f) => modelSceneFieldKey(f) === key)
	)
		return undefined;
	const updated = { ...texts, [key]: next };
	return { texts: updated, ...editModelSceneDraft({ state, texts: updated }) };
}
