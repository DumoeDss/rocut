import * as wasm from "opencut-wasm";
import type {
	NativeTransitionStyle,
	PeelTransitionStyle,
	BendTransitionStyle,
} from "@opencut/editor-contracts";
import { isValidTransitionIn } from "@opencut/editor-contracts/engine/invariant";

export interface NativeTransitionStyleCore {
	nativeTransitionStyleValidateJson?: (input: string) => string;
	mvRecipeCatalogJson?: () => string;
}
const runtime = wasm as unknown as NativeTransitionStyleCore;
export const PEEL_UNAVAILABLE =
	"Peel transitions are unavailable in this runtime core. Update the runtime; no cross-dissolve fallback was applied.";
export const BEND_UNAVAILABLE =
	"Bend transitions are unavailable in this runtime core. Update the runtime; no cross-dissolve fallback was applied.";

/** Thin native seam: JS checks transport only, never duplicates Rust transition range rules. */
export function validateNativeTransitionStyle(
	style: NativeTransitionStyle,
	core = runtime,
): NativeTransitionStyle {
	if (
		!isValidTransitionIn({
			...style,
			outgoingClipId: "style-validation",
			durationFrames: 2,
		})
	)
		throw Error("Invalid native transition style transport");
	if (style.kind === "cross-dissolve") return style;
	if (typeof core.nativeTransitionStyleValidateJson !== "function")
		throw Error(style.kind === "bend" ? BEND_UNAVAILABLE : PEEL_UNAVAILABLE);
	const result: unknown = JSON.parse(
		core.nativeTransitionStyleValidateJson(JSON.stringify(style)),
	);
	if (
		!result ||
		typeof result !== "object" ||
		!isValidTransitionIn({
			...result,
			outgoingClipId: "style-validation",
			durationFrames: 2,
		}) ||
		(result as { kind?: unknown }).kind !== style.kind
	)
		throw Error(
			`Invalid native ${style.kind === "bend" ? "Bend" : "Peel"} validation response`,
		);
	return result as NativeTransitionStyle;
}

/** Display actual catalog suggestions only when this runtime can validate the new native style. */
export function nativeTransitionDefaults(
	kind: "peel" | "bend",
	core = runtime,
): {
	style?: PeelTransitionStyle | BendTransitionStyle;
	error?: string;
} {
	if (
		typeof core.nativeTransitionStyleValidateJson !== "function" ||
		typeof core.mvRecipeCatalogJson !== "function"
	)
		return { error: kind === "bend" ? BEND_UNAVAILABLE : PEEL_UNAVAILABLE };
	try {
		const parameters = JSON.parse(core.mvRecipeCatalogJson())
			.transitionParameters?.[kind]?.parameters;
		const style =
			kind === "peel"
				? {
						kind,
						direction: parameters?.direction?.suggested,
						curl: parameters?.curl?.suggested,
						segments: parameters?.segments?.suggested,
						shading: parameters?.shading?.suggested,
						perspective: parameters?.perspective?.suggested,
					}
				: {
						kind,
						direction: parameters?.direction?.suggested,
						hinge: parameters?.hinge?.suggested,
						angle: parameters?.angle?.suggested,
						perspective: parameters?.perspective?.suggested,
						shading: parameters?.shading?.suggested,
					};
		return {
			style: validateNativeTransitionStyle(
				style as PeelTransitionStyle | BendTransitionStyle,
				core,
			) as PeelTransitionStyle | BendTransitionStyle,
		};
	} catch (error) {
		return {
			error:
				error instanceof Error ? error.message : `${kind} catalog unavailable`,
		};
	}
}
export function nativePeelDefaults(core = runtime): {
	style?: PeelTransitionStyle;
	error?: string;
} {
	return nativeTransitionDefaults("peel", core) as {
		style?: PeelTransitionStyle;
		error?: string;
	};
}
export function nativeBendDefaults(core = runtime): {
	style?: BendTransitionStyle;
	error?: string;
} {
	return nativeTransitionDefaults("bend", core) as {
		style?: BendTransitionStyle;
		error?: string;
	};
}

export function transitionStyleOf(
	transition: NativeTransitionStyle,
): NativeTransitionStyle {
	return transition.kind === "cross-dissolve"
		? { kind: "cross-dissolve" }
		: transition.kind === "bend"
			? {
					kind: "bend",
					direction: transition.direction,
					hinge: transition.hinge,
					angle: transition.angle,
					perspective: transition.perspective,
					shading: transition.shading,
				}
			: {
					kind: "peel",
					direction: transition.direction,
					curl: transition.curl,
					segments: transition.segments,
					shading: transition.shading,
					perspective: transition.perspective,
				};
}
