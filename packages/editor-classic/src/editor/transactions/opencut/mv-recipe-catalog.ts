import { mvRecipeCatalogJson } from "opencut-wasm";
import { mvRecipeSceneKinds } from "./mv-recipe-scene-discovery";

export function getMvRecipeCatalog() {
	const extensions: {
		version: number;
		availability: string;
		generators: Record<string, unknown>;
		nativeOwnerScenes?: Record<string, unknown>;
		referenceScenes?: Record<string, unknown>;
		transitionParameters: Record<string, unknown>;
		finishing: {
			effects: Record<string, unknown>;
			automation: Record<string, unknown>;
		};
		postStages: {
			supported: string[];
			default: string;
			order: string;
			targets: string;
			scope: string;
			passBudget: number;
			passCost: string;
		};
	} = JSON.parse(mvRecipeCatalogJson());
	return {
		version: 1,
		contract:
			"source.recipe; canvas-worker with empty code; Rust-validated parameters, no expressions",
		scenes: mvRecipeSceneKinds(extensions),
		extensions,
		postStages: extensions.postStages,
		finishing: extensions.finishing,
		postAutomation: extensions.finishing.automation,
		audioAnalysis: {
			importEndpoint: "programmatic/resources/import-audio",
			contract:
				"completed creator-mv-audio/1 directory + expectedAudioSha256 + explicit accepted review; normalized rocut-mv-audio/1 project attachment",
			binding:
				"recipe.audio = { resource, inputSha256 }; declared analysis resource; caller verifies actual audio digest",
			signals: ["envelope", "beatPulse", "barPulse"],
			channels: [
				"mix_rms",
				"low_power",
				"mid_power",
				"high_power",
				"vocal_rms",
			],
			cameraTargets: ["x", "y", "zoom"],
			spriteTargets: ["x", "y", "scale", "rotation", "opacity"],
			postTargets: "effect index; amount only; no grade/palette",
			clock:
				"explicit song (outer) or source (ref/drawingFps); outer post always follows song",
			missing:
				"explicit zero or error; no BPM extrapolation beyond real adjacent beats",
		},
		sprites: {
			features: [
				"enter",
				"exit",
				"wave",
				"shadow",
				"rim",
				"silhouette",
				"glow",
			],
			clock:
				"drawingFps samples pose, entrances and wave together; references remap them; camera stays independent",
			alpha:
				"sprite-group opacity; additive rim/glow expand alpha inside selected sprite role",
		},
		composition: {
			timeMap:
				"integer source-frame knots; endpoint hold; per-reference quantization; outer post/audio clock unchanged",
			sequence:
				"explicit half-open shot intervals; transparent gaps; not Blender image seq or beat inference",
			panels:
				"convex reveals, cover cameras, hero expansion, role-specific border; stylistic reference layers incomplete",
		},
		transitions: [
			"cut",
			"xfade",
			"flash",
			"black",
			"iris",
			"irisClose",
			"barrier",
			"wipe",
			"slices",
			"push",
			"zoom",
			"ink",
			"shatter",
			...Object.keys(extensions.transitionParameters),
		],
		post: [
			"grade",
			"palette",
			"vignette",
			"grain",
			"lineBoil",
			"glitch",
			"chromaticAberration",
			"zoomBlur",
			"bloom",
			...Object.keys(extensions.finishing.effects),
		],
		spatialPost: {
			requires: "worker-webgl2; runtime-availability-not-probed-by-catalog",
			color: "premultiplied-srgb-rgba8; transparent-outside-frame; not-HDR",
			bloomAlpha: ["preserve", "expand"],
		},
		easings: [
			"linear",
			"inOutSine",
			"inOutCubic",
			"inExpo",
			"outExpo",
			"inOutExpo",
			"inQuad",
			"outQuad",
		],
		roles: ["background", "subject", "graphics", "foreground"],
		lyrics: "separate-native-motion-text-track",
		coverage:
			"parameterized-transition-mechanisms; scenes-and-post-still-partial; not-reference-pixel-parity",
	};
}
