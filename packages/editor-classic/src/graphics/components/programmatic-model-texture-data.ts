import { isProgrammaticResource } from "@opencut/editor-contracts";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	particleDraft,
	particleRecord,
	particleFieldsDisabled,
} from "./programmatic-particle-data";
import { modelSceneResourceFields } from "./programmatic-model-scene-data";

export const MODEL_TEXTURE_SLOTS = [
	"map",
	"emissiveMap",
	"normalMap",
	"roughnessMap",
	"metalnessMap",
	"alphaMap",
] as const;
export const MODEL_TEXTURE_CONSUMER_MARKER =
	"// rocut-model-texture-bindings-v1";
export function modelTextureConsumerIssue(
	state: BuildDraftSnapshot,
): string | undefined {
	const file = state.files["model-feature-scene.ts"];
	if (!file)
		return "Load the archived model-feature-scene.ts author file to check texture binding support. No source upgrade or fallback is applied.";
	const marked = (code: string) =>
		code.split(MODEL_TEXTURE_CONSUMER_MARKER).length === 2;
	return marked(file.original) && marked(file.code)
		? undefined
		: "This archived/current scene does not advertise texture binding consumer v1. Existing JSON is retained; no source upgrade was applied.";
}
export type ModelTextureTexts = {
	imageId: string;
	mesh: string;
	material: string;
	slot: string;
	flipY: string;
};
export const blankModelTexture = (): ModelTextureTexts => ({
	imageId: "",
	mesh: "",
	material: "",
	slot: "",
	flipY: "",
});
const complete = (value: unknown, source = false) => {
	const v = particleRecord(value);
	return (
		isProgrammaticResource(value) &&
		!!v &&
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
};
/** Fixed archived model scene only. Descriptors are not decoded mesh admission. */
export function modelTextureContext(state: BuildDraftSnapshot) {
	const build = state.baseline.build,
		baseline = particleRecord(build?.inputProps);
	if (
		build?.engine !== "three" ||
		build.entryFile !== "model-feature-scene.ts" ||
		state.entryFile !== build.entryFile ||
		state.fileIds.filter((id) => id === build.entryFile).length !== 1 ||
		baseline?.assetKind !== "model"
	)
		return undefined;
	const inputs = build.inputs.filter((input) => input.id === build.entryFile);
	if (inputs.length !== 1 || !complete(inputs[0], true)) return undefined;
	if (modelTextureConsumerIssue(state)) return undefined;
	const fields = modelSceneResourceFields(state),
		models = fields.find((field) => field.key === "modelId")?.choices;
	if (
		!models?.some(
			(resource) =>
				resource.id === baseline.modelId &&
				resource.mimeType === "model/gltf-binary",
		)
	)
		return undefined;
	const resources = state.baseline.resources ?? [];
	const images = resources
		.filter(
			(resource) =>
				resource.kind === "image" &&
				["image/png", "image/jpeg", "image/webp"].includes(resource.mimeType) &&
				complete(resource) &&
				resources.filter((other) => other.id === resource.id).length === 1,
		)
		.map((resource) => resource.id);
	return images.length ? { images, models } : undefined;
}
export function modelTextureTexts(
	value: unknown,
): ModelTextureTexts | undefined {
	const binding = particleRecord(value);
	if (!binding) return undefined;
	return {
		imageId: typeof binding.imageId === "string" ? binding.imageId : "",
		mesh: typeof binding.mesh === "string" ? binding.mesh : "",
		material:
			typeof binding.material === "number" ? String(binding.material) : "",
		slot: typeof binding.slot === "string" ? binding.slot : "",
		flipY: typeof binding.flipY === "boolean" ? String(binding.flipY) : "",
	};
}
export function editModelTexture({
	state,
	canCompile,
	index,
	texts,
	remove = false,
}: {
	state: BuildDraftSnapshot;
	canCompile: boolean;
	index?: number;
	texts?: ModelTextureTexts;
	remove?: boolean;
}): { inputProps?: string; error?: string } {
	if (particleFieldsDisabled({ state, canCompile }))
		return {
			error:
				"Texture editing is unavailable while busy, conflicted or read-only.",
		};
	const context = modelTextureContext(state),
		props = particleDraft(state.inputProps);
	if (
		!context ||
		!props ||
		props.assetKind !== "model" ||
		!context.models.some((model) => model.id === props.modelId)
	)
		return {
			error:
				"Select a declared complete GLB and retain the model scene kind first.",
		};
	const bindings =
		props.textureBindings === undefined ? [] : props.textureBindings;
	if (!Array.isArray(bindings))
		return {
			error: "textureBindings must be an array. Original JSON is retained.",
		};
	if (
		index !== undefined &&
		(!Number.isInteger(index) || index < 0 || index >= bindings.length)
	)
		return { error: "The binding changed outside this local draft." };
	if (remove) {
		if (index === undefined)
			return { error: "Select an existing binding to remove." };
		props.textureBindings = bindings.filter(
			(_, position) => position !== index,
		);
	} else {
		if (
			!texts ||
			!context.images.includes(texts.imageId) ||
			!texts.mesh.trim() ||
			!texts.material.trim() ||
			!Number.isSafeInteger(Number(texts.material)) ||
			Number(texts.material) < 0 ||
			!(MODEL_TEXTURE_SLOTS as readonly string[]).includes(texts.slot) ||
			!["true", "false"].includes(texts.flipY)
		)
			return {
				error:
					"Enter an image, exact unique mesh name, zero-based material integer, slot and explicit flipY. Local text is retained; final scene admission checks the actual model.",
			};
		if (index === undefined && bindings.length >= 64)
			return { error: "At most 64 bindings; local text is retained." };
		const prior = index === undefined ? {} : particleRecord(bindings[index]);
		if (!prior)
			return {
				error:
					"This old binding is not an object. Edit advanced JSON or explicitly remove it; it is retained.",
			};
		const binding = {
			...prior,
			imageId: texts.imageId,
			mesh: texts.mesh,
			material: Number(texts.material),
			slot: texts.slot,
			flipY: texts.flipY === "true",
		};
		props.textureBindings =
			index === undefined
				? [...bindings, binding]
				: bindings.map((entry, position) =>
						position === index ? binding : entry,
					);
	}
	return { inputProps: JSON.stringify(props, null, 2) };
}
