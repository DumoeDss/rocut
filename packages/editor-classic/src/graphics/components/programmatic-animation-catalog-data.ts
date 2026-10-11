import {
	isProgrammaticResource,
	type ProgrammaticResource,
} from "@opencut/editor-contracts";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	objectAnimationFieldsVisible,
	objectAnimationClipType,
	editObjectAnimationDraft,
	authorObjectAnimation,
	objectAnimationAuthoringIndexesAvailable,
} from "./programmatic-object-animation-data";
import { particleRecord, particleDraft } from "./programmatic-particle-data";

export type InspectAnimation = (args: {
	resource: ProgrammaticResource;
	signal: AbortSignal;
}) => Promise<unknown>;
export interface AnimationCatalogClip {
	index: number;
	name: string;
	duration: number;
}

export async function readAnimationCatalog(
	inspect: InspectAnimation,
	resource: ProgrammaticResource,
	signal: AbortSignal,
) {
	signal.throwIfAborted();
	const result = await inspect({ resource, signal });
	signal.throwIfAborted();
	return animationCatalogClips(result, resource);
}

export function animationCatalogResource(state: BuildDraftSnapshot) {
	if (!objectAnimationFieldsVisible({ state })) return undefined;
	const modelId = particleRecord(state.baseline.build?.inputProps)?.modelId;
	return state.baseline.resources?.find(
		(resource) =>
			resource.id === modelId &&
			resource.kind === "model" &&
			resource.mimeType === "model/gltf-binary" &&
			isProgrammaticResource(resource),
	);
}

/** Validate metadata transport only; the authenticated Host owns GLB inspection. */
export function animationCatalogClips(
	value: unknown,
	resource: ProgrammaticResource,
): AnimationCatalogClip[] {
	const catalog = particleRecord(value),
		identity = particleRecord(catalog?.resource);
	if (
		catalog?.version !== 1 ||
		identity?.id !== resource.id ||
		identity.sha256 !== resource.sha256 ||
		identity.byteLength !== resource.byteLength ||
		!Array.isArray(catalog.clips)
	)
		throw Error("Invalid animation catalog resource identity");
	const indexes = new Set<number>();
	return catalog.clips.map((value) => {
		const clip = particleRecord(value);
		if (
			!clip ||
			typeof clip.index !== "number" ||
			!Number.isSafeInteger(clip.index) ||
			clip.index < 0 ||
			indexes.has(clip.index) ||
			typeof clip.name !== "string" ||
			typeof clip.duration !== "number" ||
			!Number.isFinite(clip.duration) ||
			clip.duration < 0
		)
			throw Error("Invalid animation catalog clip metadata");
		indexes.add(clip.index);
		return { index: clip.index, name: clip.name, duration: clip.duration };
	});
}

export function catalogClipSelectable(
	clip: AnimationCatalogClip,
	clips: AnimationCatalogClip[],
	type?: "name" | "index",
) {
	return (
		type === "index" ||
		(type === "name" &&
			!!clip.name &&
			clips.filter((item) => item.name === clip.name).length === 1)
	);
}

export function selectAnimationCatalogClip(
	state: BuildDraftSnapshot,
	clips: AnimationCatalogClip[],
	index: number,
) {
	if (
		state.phase ||
		state.conflict ||
		particleDraft(state.inputProps)?.modelId !==
			animationCatalogResource(state)?.id
	)
		return undefined;
	const clipType = objectAnimationClipType({ state }),
		clip = clips.find((item) => item.index === index);
	if (!clip || !catalogClipSelectable(clip, clips, clipType)) return undefined;
	return editObjectAnimationDraft({
		text: state.inputProps,
		key: "clip",
		clipType,
		next: clipType === "index" ? clip.index : clip.name,
	});
}

/** Explicit catalog identity is required before installing optional animation. */
export function addAnimationCatalogClip(
	state: BuildDraftSnapshot,
	clips: AnimationCatalogClip[],
	index: number,
	type: "name" | "index",
	mode: "loop" | "clamp",
	speed: number,
	offset: number,
) {
	if (type === "index" && !objectAnimationAuthoringIndexesAvailable(state))
		return undefined;
	const clip = clips.find((item) => item.index === index);
	if (!clip || !catalogClipSelectable(clip, clips, type)) return undefined;
	return authorObjectAnimation({
		state,
		animation: {
			clip: type === "index" ? clip.index : clip.name,
			mode,
			speed,
			offset,
		},
	});
}
