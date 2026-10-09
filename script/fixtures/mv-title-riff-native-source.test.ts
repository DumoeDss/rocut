import { expect, test } from "bun:test";
import { TITLE_RIFF_FONTS } from "./mv-title-riff-reference-contract";
import {
	titleRiffTestFrame,
	titleRiffTestSong,
} from "./mv-title-riff-reference-cases";
import {
	titleRiffNativeResources,
	titleRiffNativeSample,
	titleRiffNativeSource,
} from "./mv-title-riff-native-source";

// Source-mapping fixtures only; real font/image verification belongs to the browser gate.
function resources() {
	const body = new ArrayBuffer(0),
		sha256 = "1".repeat(64);
	return titleRiffNativeResources(
		TITLE_RIFF_FONTS.map((font, index) => ({
			...font,
			id: `font-${index}.ttf`,
			body,
			mimeType: "font/ttf",
			byteLength: 0,
			sha256,
		})),
		["character.png", "sky.png", "dawn.png"].map((id) => ({
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

test("native title source retains explicit complete args and original font roles/weights", () => {
	const frame = titleRiffTestFrame("outro"),
		song = titleRiffTestSong();
	const source = titleRiffNativeSource(frame, song, resources());
	expect(source.frameRate).toEqual({ numerator: 60, denominator: 1 });
	expect(source.durationFrames).toBe(600);
	expect(source.recipe?.songStartSeconds).toBe(20.25);
	const scene = source.recipe?.nodes[0]?.scene;
	if (scene?.kind !== "titleRiff") throw Error("Missing title source");
	expect(scene.span).toEqual({ startFrame: 0, durationFrames: 600 });
	expect(scene.settings).toEqual({
		...frame.args,
		fonts: {
			title: "font-0.ttf",
			hud: "font-1.ttf",
			ruby: "font-2.ttf",
			subtitle: "font-3.ttf",
		},
		beats: {
			kind: "manual",
			songTicks: Array.from({ length: 81 }, (_, index) => index * 60000),
		},
		bpm: 120,
		downbeatIndex0: 2,
		credit: "LOCAL ORACLE",
	});
	expect(source.resources?.map((resource) => resource.id)).toContain(
		"dawn.png",
	);
	const intro = titleRiffNativeSource(
		titleRiffTestFrame("intro"),
		song,
		resources(),
	);
	expect(intro.resources?.map((resource) => resource.id)).not.toContain(
		"dawn.png",
	);
});

test("oracle sampling uses exact native integer ticks, not requested off-grid decimals", () => {
	const frame = titleRiffTestFrame("intro");
	expect(titleRiffNativeSample(frame, 413).time).toBe(1096000 / 120000);
	expect(titleRiffNativeSample(frame, 413).time).not.toBe(9.13);
	expect(titleRiffNativeSample(frame, 0).time).toBe(2.25);
	expect(titleRiffNativeSample(frame, 599).time).toBe(1468000 / 120000);
	for (const invalid of [-1, 600, 0.5, NaN])
		expect(() => titleRiffNativeSample(frame, invalid)).toThrow();
});

test("fixture setup cannot silently drop hidden images or substitute wrong font weight", () => {
	const frame = titleRiffTestFrame("outro"),
		song = titleRiffTestSong(),
		assets = resources();
	expect(() =>
		titleRiffNativeSource(
			frame,
			song,
			assets.filter(({ resource }) => resource.id !== "dawn.png"),
		),
	).toThrow("Missing/duplicate");
	expect(() =>
		titleRiffNativeSource(frame, song, [...assets, assets[0]!]),
	).toThrow("Missing/ambiguous");
	const wrong = assets.map((asset) =>
		asset.resource.font?.weight === 500
			? {
					...asset,
					resource: {
						...asset.resource,
						font: { ...asset.resource.font, weight: 400 },
					},
				}
			: asset,
	);
	expect(() => titleRiffNativeSource(frame, song, wrong)).toThrow(
		"Missing/ambiguous",
	);
});
