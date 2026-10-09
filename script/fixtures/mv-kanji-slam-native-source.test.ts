import { expect, test } from "bun:test";
import { KANJI_SLAM_FONTS } from "./mv-kanji-slam-reference-contract";
import {
	kanjiSlamTestFrame,
	kanjiSlamTestSong,
} from "./mv-kanji-slam-reference-cases";
import {
	kanjiSlamNativeResources,
	kanjiSlamNativeSample,
	kanjiSlamNativeSource,
	kanjiSlamNativeColor,
} from "./mv-kanji-slam-native-source";
import {
	kanjiSlamExplicitCases,
	KANJI_NATIVE_BOUNDARIES,
	KANJI_NATIVE_SAMPLES,
} from "./mv-kanji-slam-native-cases";

// Contract-only empty bodies; real font identity/coverage/alpha must pass browser gates.
function resources() {
	const body = new ArrayBuffer(0),
		sha256 = "1".repeat(64);
	return kanjiSlamNativeResources(
		KANJI_SLAM_FONTS.map((font, index) => ({
			...font,
			id: `font-${index}.ttf`,
			body,
			mimeType: "font/ttf",
			byteLength: 0,
			sha256,
		})),
		["character.png", "sky.png"].map((id) => ({
			id,
			body,
			mimeType: "image/png",
			byteLength: 0,
			sha256,
			width: 1,
			height: 1,
			hasTransparency: id === "character.png",
		})),
	);
}
test("native kanji source retains every authored field, all three real font roles and exact song ticks", () => {
	const assets = resources(),
		song = kanjiSlamTestSong();
	for (const variant of ["default", "night", "hand"] as const) {
		const frame = kanjiSlamTestFrame(variant, 4.8),
			source = kanjiSlamNativeSource(frame, song, assets);
		expect(source.frameRate).toEqual({ numerator: 60, denominator: 1 });
		expect(source.durationFrames).toBe(240);
		expect(source.recipe?.songStartSeconds).toBe(4);
		expect(source.code).toBe("");
		expect(source.recipe?.post).toEqual([]);
		const scene = source.recipe?.nodes[0]?.scene;
		if (scene?.kind !== "kanjiSlam") throw Error("Missing native scene");
		expect(scene.span).toEqual({ startFrame: 0, durationFrames: 240 });
		const {
			fam: _fam,
			weight: _weight,
			color,
			rim,
			skyGrad,
			...args
		} = frame.args;
		expect(scene.settings).toEqual({
			...args,
			color: kanjiSlamNativeColor(color),
			rim: kanjiSlamNativeColor(rim),
			...(skyGrad
				? {
						skyGrad: skyGrad.map(
							([offset, value]) =>
								[offset, kanjiSlamNativeColor(value)] as const,
						),
					}
				: {}),
			fonts: {
				monument: "font-0.ttf",
				lyric: "font-1.ttf",
				counter: "font-2.ttf",
			},
			beats: {
				kind: "manual",
				songTicks: song.beats.map((time) => Math.round(time * 120000)),
			},
			bpm: 120,
			downbeatIndex0: 2,
		});
		expect(Object.hasOwn(scene.settings, "fam")).toBe(false);
		expect(Object.hasOwn(scene.settings, "weight")).toBe(false);
	}
});
test("explicit branches preserve row/zero wind, no plate gradient, noFlash and fire-night combination", () => {
	const cases = kanjiSlamExplicitCases(),
		assets = resources(),
		song = kanjiSlamTestSong();
	for (const item of cases) {
		const source = kanjiSlamNativeSource(item.input, song, assets);
		const scene = source.recipe?.nodes[0]?.scene;
		if (scene?.kind !== "kanjiSlam") throw Error("Missing native scene");
		expect(scene.settings.wind).toEqual(item.input.args.wind);
		expect(scene.settings.fire).toBe(item.input.args.fire);
		expect(scene.settings.noFlash).toBe(item.input.args.noFlash);
		if (item.input.args.bg === null) {
			expect(
				source.resources?.some((resource) => resource.id === "sky.png"),
			).toBe(false);
			expect(scene.settings.skyGrad).toEqual(
				item.input.args.skyGrad?.map(([offset, color]) => [
					offset,
					kanjiSlamNativeColor(color),
				]),
			);
		}
	}
	expect(
		cases.find((c) => c.label === "fire-night-high-rim")?.input.args,
	).toMatchObject({ fire: true, sky: "night", rimA: 1, haloA: 1 });
});
test("native oracle sampling and boundary neighbors use exactly representable120kHz ticks", () => {
	const frame = kanjiSlamTestFrame("default", 6.18);
	expect(kanjiSlamNativeSample(frame, 131).time).toBe(742000 / 120000);
	expect(kanjiSlamNativeSample(frame, 131).time).not.toBe(6.18);
	expect(kanjiSlamNativeSample(frame, 0).time).toBe(4);
	for (const index of KANJI_NATIVE_SAMPLES)
		expect(kanjiSlamNativeSample(frame, index).time).toBeLessThan(8);
	for (const invalid of [-1, 240, 0.5, NaN, Infinity])
		expect(() => kanjiSlamNativeSample(frame, invalid)).toThrow();
	for (const boundary of KANJI_NATIVE_BOUNDARIES) {
		const beats = [...kanjiSlamTestSong().beats];
		beats[boundary.beatIndex] = boundary.tick / 120000;
		const source = kanjiSlamNativeSource(
			frame,
			{ ...kanjiSlamTestSong(), beats },
			resources(),
		);
		const scene = source.recipe?.nodes[0]?.scene;
		if (scene?.kind !== "kanjiSlam" || scene.settings.beats.kind !== "manual")
			throw Error("Wrong clock");
		expect(scene.settings.beats.songTicks[boundary.beatIndex]).toBe(
			boundary.tick,
		);
	}
});
test("mapping rejects missing images, duplicate face and wrong weight/style instead of substituting", () => {
	const frame = kanjiSlamTestFrame("default", 4),
		song = kanjiSlamTestSong(),
		assets = resources();
	expect(() =>
		kanjiSlamNativeSource(
			frame,
			song,
			assets.filter(({ resource }) => resource.id !== "sky.png"),
		),
	).toThrow("Missing/duplicate");
	expect(() =>
		kanjiSlamNativeSource(frame, song, [...assets, assets[0]!]),
	).toThrow("Missing/ambiguous");
	for (const changed of [{ weight: 400 }, { style: "italic" }] as const) {
		const wrong = assets.map((asset) =>
			asset.resource.font?.weight === 700
				? {
						...asset,
						resource: {
							...asset.resource,
							font: { ...asset.resource.font, ...changed },
						},
					}
				: asset,
		);
		expect(() => kanjiSlamNativeSource(frame, song, wrong)).toThrow(
			"Missing/ambiguous",
		);
	}
	for (const color of ["red", "#fff", "#ffffffff", "rgb(0,0,0)"])
		expect(() => kanjiSlamNativeColor(color)).toThrow();
	expect(kanjiSlamNativeColor("#00ff7F")).toEqual([0, 1, 127 / 255, 1]);
});
