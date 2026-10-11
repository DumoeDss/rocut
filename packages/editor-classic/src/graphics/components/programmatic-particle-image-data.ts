import {
	isProgrammaticResource,
	type ProgrammaticResource,
} from "@opencut/editor-contracts";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	editParticleDraft,
	particleDraft,
	particleFieldsDisabled,
	particleRecord,
} from "./programmatic-particle-data";

function complete(
	resource: unknown,
	source = false,
): resource is ProgrammaticResource {
	return (
		isProgrammaticResource(resource) &&
		!!resource.id &&
		resource.byteLength > 0 &&
		/^[a-f0-9]{64}$/.test(resource.sha256) &&
		resource.attachmentKey ===
			`${source ? "programmatic-source" : "programmatic"}-sha256-${resource.sha256}` &&
		(!source ||
			(resource.kind === "source" &&
				resource.mimeType === "application/octet-stream"))
	);
}

export function particleImageResources(state: BuildDraftSnapshot) {
	const resources = state.baseline.resources ?? [];
	return resources.filter(
		(resource) =>
			resource.kind === "image" &&
			["image/png", "image/jpeg", "image/webp"].includes(resource.mimeType) &&
			complete(resource) &&
			resources.filter((item) => item.id === resource.id).length === 1,
	);
}

/** Archived image-scene identity only; this is not a sampler or renderer capability probe. */
export function particleImageFieldsVisible(state: BuildDraftSnapshot) {
	const build = state.baseline.build,
		props = particleRecord(build?.inputProps);
	const entries = build?.inputs.filter((input) => input.id === build.entryFile);
	return (
		build?.engine === "three" &&
		build.entryFile === "particle-image-scene.ts" &&
		build.capabilities?.includes("particle-surface-v1") === true &&
		entries?.length === 1 &&
		complete(entries[0], true) &&
		typeof props?.imageId === "string" &&
		particleImageResources(state).length > 0
	);
}

/** Change an existing field only, retaining unknown IDs, omitted plane fields and sampling controls. */
export function editParticleImageDraft({
	state,
	canCompile,
	key,
	next,
}: {
	state: BuildDraftSnapshot;
	canCompile: boolean;
	key: "imageId" | "width" | "height" | "alphaTest";
	next: unknown;
}) {
	if (
		particleFieldsDisabled({ state, canCompile }) ||
		!particleImageFieldsVisible(state)
	)
		return undefined;
	const props = particleDraft(state.inputProps);
	if (!props) return undefined;
	if (key === "imageId") {
		if (
			typeof props.imageId !== "string" ||
			typeof next !== "string" ||
			!particleImageResources(state).some((resource) => resource.id === next)
		)
			return undefined;
	} else if (
		typeof next !== "number" ||
		!Number.isFinite(next) ||
		(key === "alphaTest" ? next < 0 || next > 1 : next <= 0)
	)
		return undefined;
	return editParticleDraft({
		text: state.inputProps,
		path: key === "width" || key === "height" ? ["plane", key] : [key],
		next,
	});
}
