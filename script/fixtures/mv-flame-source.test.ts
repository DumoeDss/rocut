import { expect, test } from "bun:test";
import { flameCases } from "./mv-flame-cases";
import { flameAnalysis, flameSample, flameSource } from "./mv-flame-source";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { omitFlameFingers } from "./mv-flame-native-mutations";
import type { MvFlamePlan } from "@opencut/editor-contracts";

test("Flame author adapter preserves defaults, explicit empty stops and song ticks", () => {
	const item = flameCases().find((c) => c.label === "breathe-default")!;
	const source = flameSource({
		frame: item.frame,
		song: item.song,
		resources: [],
	});
	const scene = source.recipe!.nodes[0]!.scene;
	if (scene.kind !== "flame") throw Error("Wrong source");
	expect(scene.settings.mode).toBeUndefined();
	expect(scene.settings.stops).toBeUndefined();
	expect(scene.settings.vocal).toBeUndefined();
	expect(scene.settings.beats).toEqual({
		kind: "manual",
		songTicks: item.song.beats.map((t) => Math.round(t * 120000)),
	});
	const empty = flameSource({
		frame: { ...item.frame, args: { stops: [] } },
		song: item.song,
		resources: [],
		options: { vocal: "zero" },
	}).recipe!.nodes[0]!.scene;
	if (empty.kind !== "flame") throw Error("Wrong source");
	expect(empty.settings.stops).toEqual([]);
	expect(empty.settings.vocal).toBe("zero");
	expect(flameSample({ frame: item.frame, index: 5 }).time).toBe(
		(480000 + 10000) / 120000,
	);
	for (const index of [-1, 240, 0.5, Number.NaN])
		expect(() => flameSample({ frame: item.frame, index: index })).toThrow();
});
test("Flame reviewed audio preserves independent original vocal samples and ordered stops", async () => {
	const item = flameCases().find((c) => c.label === "breathe-global-stops")!;
	const analysis = await flameAnalysis(item.song);
	const value = JSON.parse(new TextDecoder().decode(analysis.body));
	expect(value.channels.vocal_rms).toEqual(item.song.envelope!.vocal);
	expect(value.fps).toBe(item.song.envelope!.fps);
	expect(value.stops).toEqual(item.song.stops);
	expect(value.provenance.review.status).toBe("accepted");
	expect(value.provenance.vocalSha256).toBe(
		await digest(
			new TextEncoder().encode(JSON.stringify(item.song.envelope!.vocal))
				.buffer,
		),
	);
});
test("Each Flame mode has full-size, nonmonotonic exact-repeat fixture coverage", () => {
	for (const item of flameCases()) {
		const source = flameSource({
			frame: item.frame,
			song: item.song,
			resources: [],
		});
		expect([source.width, source.height]).toEqual([1920, 1080]);
		expect(new Set(item.indices).size).toBe(item.indices.length - 1);
		expect(item.indices.slice(0, -1)).toContain(item.indices.at(-1)!);
		for (const index of item.indices)
			expect(
				Number.isFinite(flameSample({ frame: item.frame, index: index }).time),
			).toBe(true);
	}
});

const privateWasmDirectory = process.env.ROCUT_FLAME_PRIVATE_WASM;
test("Flame no-fingers control mutates the nested scene paint exactly once, never a no-op", () => {
	const data: MvFlamePlan = {
		rasterBudgetBytes: 1,
		commands: [
			{
				kind: "surface",
				id: "fl-scene",
				size: [1920, 1080],
				commands: [
					{
						kind: "blit",
						surface: "fl-fingers",
						sourceRect: [0, 0, 1920, 1080],
						destinationRect: [0, 0, 1920, 1080],
						transform: [1, 0, 0, 1, 0, 0],
						composite: "source-over",
						opacity: 1,
					},
				],
			},
		],
	};
	const original = structuredClone(data);
	omitFlameFingers(data);
	const scene = data.commands[0];
	if (scene?.kind !== "surface") throw Error("Missing scene");
	expect(scene.commands).toEqual([]);
	expect(original.commands[0]).not.toEqual(scene);
	expect(() => omitFlameFingers(data)).toThrow("exactly one scene draw");
});
test.skipIf(!privateWasmDirectory)(
	"Every synthetic Flame analysis passes actual private WASM admission and missing vocal provenance fails",
	async () => {
		if (!privateWasmDirectory) throw Error("Private WASM directory missing");
		const wasm = await import(
			pathToFileURL(join(privateWasmDirectory, "opencut_wasm.js")).href
		);
		wasm.initSync({
			module: await readFile(
				join(privateWasmDirectory, "opencut_wasm_bg.wasm"),
			),
		});
		for (const item of flameCases()) {
			const analysis = await flameAnalysis(item.song);
			const value = JSON.parse(new TextDecoder().decode(analysis.body));
			const source = flameSource({
				frame: { ...item.frame, args: { mode: "dark" } },
				song: item.song,
				resources: [
					analysis,
					{
						body: new ArrayBuffer(1),
						resource: {
							id: "assets/char/bust_calm.png",
							kind: "image",
							mimeType: "image/png",
							byteLength: 1,
							sha256: "f".repeat(64),
							attachmentKey: `programmatic-sha256-${"f".repeat(64)}`,
						},
					},
				],
			});
			const request = {
				source,
				analysis: value,
				clipStart: 120000,
				clipDuration: source.durationFrames * 2000,
				trimStart: 0,
				timelineTime: 120000,
			};
			const admitted = JSON.parse(
				wasm.resolveProgrammaticFrameJson(JSON.stringify(request)),
			);
			expect(admitted.error).toBeUndefined();
			expect(admitted.frame).toBeDefined();
			delete value.provenance.vocalSha256;
			const rejected = JSON.parse(
				wasm.resolveProgrammaticFrameJson(JSON.stringify(request)),
			);
			expect(rejected.error).toContain("vocal provenance");
		}
	},
);
