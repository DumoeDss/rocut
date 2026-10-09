import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { MvKanjiSlam } from "../../packages/editor-contracts/src/mv-kanji-slam";
import type { MvColor } from "../../packages/editor-contracts/src/mv-recipe";
import type {
	KanjiSlamFrame,
	KanjiSlamSong,
} from "./mv-kanji-slam-reference-contract";
import {
	kanjiRequiredImages,
	snapshotKanjiFrame,
	snapshotKanjiSong,
} from "./mv-kanji-slam-reference-input";
import { check } from "./mv-afterimage-capture";

// Byte/resource declaration is generic and contains no scene or clock math.
export { titleRiffNativeResources as kanjiSlamNativeResources } from "./mv-title-riff-native-source";

export function kanjiSlamNativeColor(value: string): MvColor {
	check(/^#[\da-fA-F]{6}$/.test(value), "Expected explicit opaque hex color");
	return [
		parseInt(value.slice(1, 3), 16) / 255,
		parseInt(value.slice(3, 5), 16) / 255,
		parseInt(value.slice(5, 7), 16) / 255,
		1,
	];
}

/** Authoring conversion only. Never evaluate original easing, layout or drawing. */
export function kanjiSlamNativeSource(
	input: KanjiSlamFrame,
	inputSong: KanjiSlamSong,
	resources: readonly ResolvedProgrammaticResource[],
): ProgrammaticSource {
	const frame = snapshotKanjiFrame(input),
		song = snapshotKanjiSong(inputSong);
	const face = (family: string, weight: number) => {
		const matches = resources.filter(
			({ resource }) =>
				resource.kind === "font" &&
				resource.font?.family === family &&
				resource.font.weight === weight &&
				resource.font.style === "normal",
		);
		check(
			matches.length === 1,
			`Missing/ambiguous actual kanjiSlam font ${family}/${weight}`,
		);
		return matches[0]!.resource.id;
	};
	const fonts = {
		monument: face("Zen Old Mincho", 900),
		lyric: face("Shippori Mincho B1", 700),
		counter: face("DotGothic16", 400),
	};
	const ids = new Set([...Object.values(fonts), ...kanjiRequiredImages(frame)]);
	const declared = resources.filter(({ resource }) => ids.has(resource.id));
	check(
		declared.length === ids.size &&
			new Set(declared.map(({ resource }) => resource.id)).size === ids.size,
		"Missing/duplicate native kanjiSlam fixture resource",
	);
	const durationFrames = frame.duration * 60;
	check(
		Number.isSafeInteger(durationFrames),
		"Fixture duration must be exactly representable at 60fps",
	);
	// Original font aliases/weight are replaced by exact admitted asset IDs.
	const {
		fam: _fam,
		weight: _weight,
		color,
		rim,
		skyGrad,
		...args
	} = frame.args;
	const settings: MvKanjiSlam = {
		...args,
		fonts,
		color: kanjiSlamNativeColor(color),
		rim: kanjiSlamNativeColor(rim),
		...(skyGrad
			? {
					skyGrad: skyGrad.map(
						([offset, value]) => [offset, kanjiSlamNativeColor(value)] as const,
					),
				}
			: {}),
		beats: {
			kind: "manual",
			songTicks: song.beats.map((time) => Math.round(time * 120000)),
		},
		bpm: song.bpm,
		downbeatIndex0: song.downbeatIndex0,
	};
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames,
		seed: 173,
		resources: declared.map(({ resource }) => resource),
		recipe: {
			version: 1,
			root: "kanji",
			outputRoles: ["background"],
			songStartSeconds: frame.shotStart,
			post: [],
			nodes: [
				{
					id: "kanji",
					scene: {
						kind: "kanjiSlam",
						role: "background",
						span: { startFrame: 0, durationFrames },
						settings,
					},
				},
			],
		},
	};
}

/** Use integer source ticks for the oracle, never a nearby off-grid decimal. */
export function kanjiSlamNativeSample(
	frame: KanjiSlamFrame,
	index: number,
): KanjiSlamFrame {
	check(
		Number.isSafeInteger(index) && index >= 0 && index < frame.duration * 60,
		"Invalid native kanjiSlam fixture index",
	);
	return {
		...frame,
		time: (Math.round(frame.shotStart * 120000) + index * 2000) / 120000,
	};
}
