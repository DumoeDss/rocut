import { isProgrammaticResource } from "@opencut/editor-contracts";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	editParticleDraft,
	particleDraft,
	particleRecord,
} from "./programmatic-particle-data";

function archivedSource(state: BuildDraftSnapshot, id: string) {
	const inputs = state.baseline.build?.inputs.filter(
		(input) => input.id === id,
	);
	if (inputs?.length !== 1) return false;
	const input = inputs[0];
	return (
		isProgrammaticResource(input) &&
		input.kind === "source" &&
		input.mimeType === "application/octet-stream" &&
		input.byteLength > 0 &&
		/^[a-f0-9]{64}$/.test(input.sha256) &&
		input.attachmentKey === `programmatic-source-sha256-${input.sha256}`
	);
}

/** Optional playback belongs only to these archived model scenes, never static native profiles. */
export function objectAnimationAuthoringAvailable(state: BuildDraftSnapshot) {
	const build = state.baseline.build,
		props = particleRecord(build?.inputProps);
	if (
		build?.engine !== "three" ||
		!props ||
		(build.entryFile === "model-feature-scene.ts"
			? props.assetKind !== "model"
			: props.assetKind !== undefined && props.assetKind !== "model") ||
		typeof props.modelId !== "string" ||
		!archivedSource(state, build.entryFile)
	)
		return false;
	const model = state.baseline.resources?.filter(
		(resource) => resource.id === props.modelId,
	);
	if (
		model?.length !== 1 ||
		!isProgrammaticResource(model[0]) ||
		model[0].kind !== "model" ||
		model[0].mimeType !== "model/gltf-binary" ||
		model[0].byteLength <= 0 ||
		!/^[a-f0-9]{64}$/.test(model[0].sha256) ||
		model[0].attachmentKey !== `programmatic-sha256-${model[0].sha256}`
	)
		return false;
	return [
		"model-feature-scene.ts",
		"glass-object-scene.ts",
		"ink-object-scene.ts",
	].includes(build.entryFile);
}

export function objectAnimationAuthoringIndexesAvailable(
	state: BuildDraftSnapshot,
) {
	return (
		objectAnimationAuthoringAvailable(state) &&
		(state.baseline.build?.entryFile === "model-feature-scene.ts" ||
			(archivedSource(state, "object-animation.mjs") &&
				nativeClipIndexesAvailable(state)))
	);
}

/** Authored GLB transport only; this is not a renderer capability probe. */
export function objectAnimationFieldsVisible({
	state,
}: {
	state: BuildDraftSnapshot;
}) {
	const source = state.baseline;
	const props = particleRecord(source.build?.inputProps);
	if (objectAnimationAuthoringAvailable(state)) return true;
	if (
		source.build?.engine !== "three" ||
		!props ||
		!Object.hasOwn(props, "animation")
	)
		return false;
	const glb =
		source.resources?.filter(
			(resource) =>
				resource.kind === "model" && resource.mimeType === "model/gltf-binary",
		) ?? [];
	if (!glb.length) return false;
	return (
		source.build.inputs.some((input) => input.id === "object-animation.mjs") ||
		(source.build.entryFile === "model-feature-scene.ts" &&
			source.build.inputs.some(
				(input) => input.id === "model-feature-scene.ts",
			) &&
			props.assetKind === "model" &&
			typeof props.modelId === "string" &&
			glb.some((resource) => resource.id === props.modelId))
	);
}

/** A real archived dependency opts native scenes into index selection; legacy stays name-only. */
function nativeClipIndexesAvailable(state: BuildDraftSnapshot) {
	return archivedSource(state, "object-animation-clip-selection.mjs");
}

export function authorObjectAnimation({
	state,
	animation,
}: {
	state: BuildDraftSnapshot;
	animation?: {
		clip: string | number;
		mode: "loop" | "clamp";
		speed: number;
		offset: number;
	};
}) {
	if (
		state.phase ||
		state.conflict ||
		!objectAnimationAuthoringAvailable(state)
	)
		return undefined;
	const root = particleDraft(state.inputProps),
		baselineProps = particleRecord(state.baseline.build?.inputProps);
	if (
		!root ||
		root.assetKind !== baselineProps?.assetKind ||
		root.modelId !== baselineProps?.modelId
	)
		return undefined;
	if (animation) {
		const baselineAnimation = particleRecord(baselineProps?.animation);
		if (
			Object.hasOwn(root, "animation") ||
			(baselineAnimation &&
				typeof baselineAnimation.clip !== typeof animation.clip) ||
			(typeof animation.clip === "number" &&
				!objectAnimationAuthoringIndexesAvailable(state)) ||
			(typeof animation.clip === "string"
				? !animation.clip
				: !Number.isSafeInteger(animation.clip) || animation.clip < 0) ||
			!["loop", "clamp"].includes(animation.mode) ||
			!Number.isFinite(animation.speed) ||
			!Number.isFinite(animation.offset)
		)
			return undefined;
		root.animation = animation;
	} else {
		if (!Object.hasOwn(root, "animation")) return undefined;
		delete root.animation;
	}
	return JSON.stringify(root, null, 2);
}

/** Keep the baseline author's clip representation; never upgrade an old archive implicitly. */
export function objectAnimationClipType({
	state,
}: {
	state: BuildDraftSnapshot;
}): "name" | "index" | undefined {
	if (!objectAnimationFieldsVisible({ state })) return undefined;
	const props = particleRecord(state.baseline.build?.inputProps);
	const clip =
		props && Object.hasOwn(props, "animation")
			? particleRecord(props.animation)?.clip
			: objectAnimationAuthoringAvailable(state)
				? objectAnimationDraft({ text: state.inputProps })?.clip
				: undefined;
	if (typeof clip === "string") return "name";
	if (
		((!["glass-object-scene.ts", "ink-object-scene.ts"].includes(
			state.baseline.build!.entryFile,
		) &&
			!state.baseline.build?.inputs.some(
				(input) => input.id === "object-animation.mjs",
			)) ||
			nativeClipIndexesAvailable(state)) &&
		typeof clip === "number" &&
		Number.isSafeInteger(clip) &&
		clip >= 0
	)
		return "index";
	return undefined;
}

export function objectAnimationDraft({ text }: { text: string }) {
	return particleRecord(particleDraft(text)?.animation);
}

/** Preserve missing/unknown author properties; do not install animation defaults. */
export function editObjectAnimationDraft({
	text,
	key,
	next,
	clipType = "name",
}: {
	text: string;
	key: "clip" | "mode" | "speed" | "offset";
	next: unknown;
	clipType?: "name" | "index";
}) {
	if (
		key === "clip" &&
		(clipType === "name"
			? typeof next !== "string" || !next
			: typeof next !== "number" || !Number.isSafeInteger(next) || next < 0)
	)
		return undefined;
	if (key === "mode" && next !== "loop" && next !== "clamp") return undefined;
	if (
		(key === "speed" || key === "offset") &&
		(typeof next !== "number" || !Number.isFinite(next))
	)
		return undefined;
	const animation = objectAnimationDraft({ text });
	if (
		!animation ||
		(key === "clip" &&
			typeof animation.clip !== (clipType === "name" ? "string" : "number"))
	)
		return undefined;
	return editParticleDraft({ text, path: ["animation", key], next });
}
