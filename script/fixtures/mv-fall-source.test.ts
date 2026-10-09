import { expect, test } from "bun:test";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { fallFrame, fallSong } from "./mv-fall-contract";
import { fallAnalysis, fallSample, fallSource } from "./mv-fall-source";
import { fallCases } from "./mv-fall-cases";
const marker: ResolvedProgrammaticResource = {
	body: new ArrayBuffer(1),
	resource: {
		id: "fall-char",
		kind: "image",
		mimeType: "image/png",
		byteLength: 1,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
	},
};
test("Fall source adapter preserves optional freeze/pulse and original integer source clock", () => {
	const frame = fallFrame(),
		song = fallSong();
	const source = fallSource(frame, song, [marker]);
	expect(source.width).toBe(1920);
	expect(source.height).toBe(1080);
	expect(source.durationFrames).toBe(240);
	const scene = source.recipe!.nodes[0]!.scene;
	if (scene.kind !== "fall") throw Error("Wrong source");
	expect(scene.settings.freeze).toBeUndefined();
	expect(scene.settings.pulse).toBeUndefined();
	expect(scene.settings.beats).toEqual({
		kind: "manual",
		songTicks: song.beats.map((t) => Math.round(t * 120000)),
	});
	expect(fallSample(frame, 83).time).toBe((480000 + 83 * 2000) / 120000);
	const explicit = fallSource(
		{ ...frame, args: { ...frame.args, freeze: [], pulse: [] } },
		song,
		[marker],
	).recipe!.nodes[0]!.scene;
	if (explicit.kind !== "fall") throw Error("Wrong source");
	expect(explicit.settings.freeze).toEqual([]);
	expect(explicit.settings.pulse).toEqual([]);
	expect(() => fallSource(frame, song, [])).toThrow("Missing Fall character");
	expect(() =>
		fallSource({ ...frame, duration: 1 / 7 }, song, [marker]),
	).toThrow();
	for (const index of [-1, 240, 0.5, Number.NaN])
		expect(() => fallSample(frame, index)).toThrow();
});
test("reviewed Fall stop input keeps original order, fractional seconds and analysis beat binding", async () => {
	const song = {
		...fallSong(),
		stops: [
			{ kind: "stop", start: 6.1, end: 6.713337 },
			{ kind: "gap", start: 4.2, end: 6.9 },
			{ kind: "stop", start: 5, end: 5.6 },
		] as const,
	};
	const analysis = await fallAnalysis(song),
		value = JSON.parse(new TextDecoder().decode(analysis.body));
	expect(value.stops).toEqual(song.stops);
	expect(value.provenance.review.status).toBe("accepted");
	const source = fallSource(fallFrame(), song, [marker, analysis]);
	expect(source.recipe!.audio).toEqual({
		resource: "fall-analysis",
		inputSha256: "a".repeat(64),
	});
	const scene = source.recipe!.nodes[0]!.scene;
	if (scene.kind !== "fall") throw Error("Wrong source");
	expect(scene.settings.beats).toEqual({ kind: "analysis" });
	expect(scene.settings.freeze).toBeUndefined();
});
test("every Fall branch has a nonmonotonic repeated frame and full-size source", async () => {
	const cases = fallCases();
	expect(cases).toHaveLength(9);
	for (const item of cases) {
		const resources = [
			marker,
			...(item.song.stops ? [await fallAnalysis(item.song)] : []),
		];
		const source = fallSource(item.frame, item.song, resources);
		expect(source.width).toBe(1920);
		expect(source.height).toBe(1080);
		expect(new Set(item.indices).size).toBe(item.indices.length - 1);
		expect(item.indices.slice(0, -1)).toContain(item.indices.at(-1)!);
		for (const i of item.indices)
			expect(Number.isFinite(fallSample(item.frame, i).time)).toBe(true);
	}
});
