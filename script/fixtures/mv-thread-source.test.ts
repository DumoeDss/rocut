import { describe, expect, test } from "bun:test";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { threadFrame, threadSong } from "./mv-thread-contract";
import { threadSource, threadSample } from "./mv-thread-source";
import { threadCases } from "./mv-thread-cases";
const resource: ResolvedProgrammaticResource = {
	body: new ArrayBuffer(1),
	resource: {
		id: "thread-hand",
		kind: "image",
		mimeType: "image/png",
		byteLength: 1,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
	},
};

describe("Thread fixture adapter is authoring-only", () => {
	test("preserves absence versus [] and never invents a variant or clock samples", () => {
		const frame = threadFrame(),
			song = threadSong();
		const first = threadSource(frame, song, [resource]);
		const scene = first.recipe!.nodes[0]!.scene;
		expect(scene.kind).toBe("thread");
		if (scene.kind !== "thread") throw Error("bad scene");
		expect(scene.settings.stops).toBeUndefined();
		expect(Object.hasOwn(scene.settings, "variant")).toBe(false);
		expect(scene.settings.beats).toEqual({
			kind: "manual",
			songTicks: song.beats.map((t) => t * 120000),
		});
		const second = threadSource(
			{ ...frame, args: { ...frame.args, stops: [] } },
			song,
			[resource],
		);
		expect(second.recipe!.nodes[0]!.scene).toMatchObject({
			settings: { stops: [] },
		});
		expect(frame.args).toEqual({ hand: "thread-hand" });
	});
	test("uses whole-song ticks and rejects off-grid frames and missing declarations", () => {
		const frame = threadFrame();
		expect(threadSample(frame, 131).time).toBe((480000 + 131 * 2000) / 120000);
		for (const index of [-1, 240, 0.5, NaN])
			expect(() => threadSample(frame, index)).toThrow();
		expect(() => threadSource(frame, threadSong(), [])).toThrow(
			"hand declaration",
		);
		expect(() =>
			threadSource({ ...frame, duration: 0.0101 }, threadSong(), [resource]),
		).toThrow("60fps grid");
	});
	test("covers defaults, global stop fallback, [] override, overlap/order, explicit args and empty beats", () => {
		const cases = threadCases();
		expect(cases.map((c) => c.label)).toEqual([
			"default",
			"reviewed-stops",
			"empty-override",
			"overlapping-unsorted",
			"explicit-placement",
			"empty-beats-explicit-arrival",
			"global-open-overlap-boundaries",
		]);
		for (const c of cases) {
			expect(
				c.indices.every(
					(i) => Number.isInteger(i) && i >= 0 && i < c.frame.duration * 60,
				),
			).toBe(true);
			expect(new Set(c.indices).size).toBe(c.indices.length - 1);
		}
		expect(cases[2]!.frame.args.stops).toEqual([]);
		expect(cases[3]!.frame.args.stops?.[0]?.[0]).toBeGreaterThan(
			cases[3]!.frame.args.stops?.[1]?.[0] ?? 0,
		);
	});
});
