import type {
	FrameRate,
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type {
	MvEmber,
	MvEmberPalette,
} from "../../packages/editor-contracts/src/mv-ember";
import type {
	EmberAudioFacts,
	EmberKey,
	EmberReferenceFrame,
} from "./mv-ember-reference-contract";

export interface EmberCase {
	readonly label: string;
	readonly shotStart: number;
	readonly duration: number;
	readonly settings: MvEmber;
	readonly original: EmberReferenceFrame["args"];
	readonly needsAnalysis: boolean;
}
export const EMBER_AUDIO_SHA = "e".repeat(64);
const ticks = (seconds: number) => Math.round(seconds * 120000);
const color = (
	r: number,
	g: number,
	b: number,
): readonly [number, number, number, number] => [r / 255, g / 255, b / 255, 1];
function palette(mode: MvEmber["mode"]): MvEmberPalette {
	return {
		background: [0, 0, 0, 1],
		aura: mode === "ignite" ? color(42, 15, 36) : color(26, 12, 31),
		dusk: color(122, 35, 80),
		verm: color(200, 55, 58),
		sunset: color(240, 102, 58),
		glow: color(255, 165, 82),
		hi: color(255, 227, 176),
		core: color(255, 246, 230),
	};
}

/** Explicit fixture content reproduces the original song's fixed HUD. It is
 * never proposed as the generic product default or stored in the catalog. */
export function emberCase(
	mode: MvEmber["mode"],
	audio: EmberAudioFacts,
	image = "wide.png",
	manual = false,
): EmberCase {
	const beats = { kind: "manual" as const, songTicks: audio.beats.map(ticks) };
	const hud = {
		font: "ember-dot.ttf",
		title: "残光 / ZANKŌ",
		clock: { hour: 17, minute: 42, fps: 30 },
	};
	if (mode === "breathe") {
		const stops = [
			[1.75, 1.9],
			[3.8, 4.25],
		] as const;
		const flares = [
			[2.4, 2.73],
			[2.55, 3.1],
			[4.57, 5.6],
		] as const;
		return {
			label: "breathe",
			shotStart: 0.6,
			duration: 6,
			needsAnalysis: true,
			settings: {
				mode,
				palette: palette(mode),
				grain: 0.07,
				beats,
				hud,
				stopsTicks: stops.map(([a, b]) => [ticks(a), ticks(b)]),
				flaresTicks: flares.map(([a, b]) => [ticks(a), ticks(b)]),
				thumpsTicks: [ticks(2.83)],
			},
			original: { mode, grain: 0.07, stops, flares, thumps: [2.83] },
		};
	}
	if (mode === "ignite")
		return {
			label: "ignite",
			shotStart: 6.1,
			duration: 5,
			needsAnalysis: true,
			settings: {
				mode,
				palette: palette(mode),
				grain: 0.07,
				beats,
				hud,
				stopsTicks: [],
				blackFrom: { kind: "lastBeat" },
				crackAtTicks: ticks(8.44),
				ring: 176,
				seed: 5,
			},
			original: {
				mode,
				grain: 0.07,
				stops: [],
				crackAt: 8.44,
				ring: 176,
				seed: 5,
			},
		};
	const keys: readonly EmberKey[] = [
		[16, 1],
		[17.2, 0.86, "soft"],
		[17.8, 0.9, "soft"],
		[18, 0.66, "out", 1],
		[18.7, 0.5, "out", 1],
		[18.5, 0.35, "out", 1],
		[19.1, 0.25, "out", 1],
		[19.3, 0.15, "soft", 1],
		[19.83, 0.003, "in"],
	];
	return {
		label: manual ? "collapse-manual" : "collapse-auto",
		shotStart: 16,
		duration: 4,
		needsAnalysis: !manual,
		settings: {
			mode,
			palette: palette(mode),
			grain: 0.06,
			image,
			focus: [200, 40],
			endTicks: ticks(20),
			keys: manual
				? {
						kind: "manual",
						values: keys.map(([time, factor, easing, hit]) => ({
							songTicks: ticks(time),
							factor,
							easing: easing ?? "out",
							hit: !!hit,
						})),
					}
				: { kind: "analysis", beats },
		},
		original: {
			mode,
			grain: 0.06,
			bg: image,
			focus: [200, 40],
			end: 20,
			...(manual ? { keys } : {}),
		},
	};
}

export function emberSource(
	test: EmberCase,
	declared: readonly ProgrammaticResource[],
	rate: FrameRate = { numerator: 30, denominator: 1 },
): ProgrammaticSource {
	const durationFrames = Math.ceil(
		(test.duration * rate.numerator) / rate.denominator,
	);
	const ids = new Set([
		...(test.needsAnalysis ? ["ember-analysis.json"] : []),
		...(test.settings.mode === "collapse"
			? [test.settings.image]
			: [test.settings.hud.font]),
	]);
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: rate,
		durationFrames: durationFrames + 1,
		seed: 0,
		resources: declared.filter((resource) => ids.has(resource.id)),
		recipe: {
			version: 1,
			root: "ember",
			songStartSeconds: test.shotStart,
			outputRoles: ["foreground"],
			...(test.needsAnalysis
				? {
						audio: {
							resource: "ember-analysis.json",
							inputSha256: EMBER_AUDIO_SHA,
						},
					}
				: {}),
			nodes: [
				{
					id: "ember",
					scene: {
						kind: "ember",
						role: "foreground",
						span: { startFrame: 0, durationFrames },
						settings: test.settings,
					},
				},
			],
		},
	};
}

export function emberOriginalFrame(
	test: EmberCase,
	source: ProgrammaticSource,
	index: number,
): EmberReferenceFrame {
	const step =
		(120000 * source.frameRate.denominator) / source.frameRate.numerator;
	const scene = source.recipe!.nodes.find(
		(node) => node.scene.kind === "ember",
	)!.scene;
	if (scene.kind !== "ember") throw Error("Missing Ember scene span");
	return {
		time: (ticks(test.shotStart) + index * step) / 120000,
		shotStart: test.shotStart,
		duration: (scene.span.durationFrames * step) / 120000,
		args: test.original,
	};
}
