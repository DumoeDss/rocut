import * as wasm from "opencut-wasm";
import {
	nativeBendDefaults,
	nativePeelDefaults,
	type NativeTransitionStyleCore,
} from "../../../transitions/transition-style";

function describeNativeStyle<T extends { kind: string }>(
	defaults: { style?: T; error?: string },
	fields: string[],
	core: NativeTransitionStyleCore,
) {
	let parameters: Record<string, unknown> | undefined;
	if (defaults.style) {
		try {
			parameters = JSON.parse(core.mvRecipeCatalogJson!()).transitionParameters[
				defaults.style.kind
			].parameters;
		} catch (error) {
			defaults = {
				error:
					error instanceof Error
						? error.message
						: "Native transition catalog unavailable",
			};
		}
	}
	return {
		availability: defaults.style
			? "implemented-not-runtime-probed"
			: "unavailable",
		validator: "nativeTransitionStyleValidateJson",
		fields,
		...(defaults.style && { defaults: defaults.style, parameters }),
		...(defaults.error && { error: defaults.error }),
		fallback: "none; missing or rejected native support is an error",
	};
}

/** Native timeline styles are separate from source.recipe scene transitions. */
export function nativeTransitionCatalog(
	core: NativeTransitionStyleCore = wasm,
) {
	return {
		version: 1,
		target: "clip.transitionIn",
		operation: "update-clip.patch.transitionIn; null removes the transition",
		placement:
			"incoming video/image clip; outgoingClipId identifies its adjacent previous clip on the same track",
		timing:
			"durationFrames; project rational frame rate; handles, overlap and progress admitted by the Rust timing core",
		persistence:
			"flattened kind/outgoingClipId/durationFrames and all authored style fields; no source.recipe or time-link style fields",
		rendering:
			"native sampled A/B branches with their effects/masks; complete optional frame style; exact A/B endpoints",
		styles: {
			"cross-dissolve": {
				availability: "implemented-not-runtime-probed",
				fields: [],
			},
			peel: describeNativeStyle(
				nativePeelDefaults(core),
				["direction", "curl", "segments", "shading", "perspective"],
				core,
			),
			bend: describeNativeStyle(
				nativeBendDefaults(core),
				["direction", "hinge", "angle", "perspective", "shading"],
				core,
			),
		},
	};
}
