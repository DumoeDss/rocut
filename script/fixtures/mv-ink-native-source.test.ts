import { expect, test } from "bun:test";
import { inkCases } from "./mv-ink-cases";
import { inkResource, inkNativeSource } from "./mv-ink-native-source";
test("Native author adapter preserves all original placements,zero seed and absolute clock binding", () => {
	const body = new Uint8Array([1]).buffer;
	const resource = inkResource({
		id: "ink-character",
		body,
		mimeType: "image/png",
		sha256: "a".repeat(64),
		byteLength: 1,
		width: 480,
		height: 960,
	});
	for (const item of inkCases()) {
		const source = inkNativeSource({
			frame: item.frame,
			song: item.song,
			resources: [resource],
		});
		expect(source.width).toBe(1920);
		expect(source.height).toBe(1080);
		expect(source.durationFrames).toBe(360);
		expect(source.recipe!.songStartSeconds).toBe(item.frame.shotStart);
		const scene = source.recipe!.nodes[0]!.scene;
		if (scene.kind !== "ink") throw Error("Wrong scene");
		for (const key of ["char", "seed", "h", "x", "y"] as const)
			expect(scene.settings[key]).toBe(item.frame.args[key]);
		expect(scene.settings.beats).toEqual({
			kind: "manual",
			songTicks: item.song.beats.map((time) => Math.round(time * 120000)),
		});
		expect(source.resources).toEqual([resource.resource]);
	}
});
