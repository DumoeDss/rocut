import { describe, expect, test } from "bun:test";
import {
	kanjiSlamTestFrame,
	kanjiSlamTestSong,
	KANJI_SAMPLES,
} from "./mv-kanji-slam-reference-cases";
import {
	snapshotKanjiFrame,
	snapshotKanjiSong,
} from "./mv-kanji-slam-reference-input";
import { loadKanjiSlamReference } from "./mv-kanji-slam-reference";
import { titleRiffFontIdentity } from "./mv-title-riff-reference-font-identity";
import { readFile } from "node:fs/promises";

describe("full original kanjiSlam admission", () => {
	test("complete explicit variants and boundary samples snapshot without mutating callers", () => {
		for (const variant of ["default", "night", "hand"] as const)
			for (const sample of KANJI_SAMPLES) {
				const input = kanjiSlamTestFrame(variant, sample.time),
					copy = snapshotKanjiFrame(input);
				expect(copy).toEqual(input);
				expect(copy.args).not.toBe(input.args);
			}
		const song = kanjiSlamTestSong(),
			copy = snapshotKanjiSong(song);
		expect(copy).toEqual(song);
		expect(copy.beats).not.toBe(song.beats);
	});
	test("rejects silent defaults, duplicate/unsorted beats and unused skyGrad", () => {
		const frame = kanjiSlamTestFrame("default", 4);
		for (const args of [
			{ ...frame.args, wind: undefined },
			{ ...frame.args, frames: [] },
			{ ...frame.args, weight: 800 },
			{
				...frame.args,
				skyGrad: [
					[0, "#112233"],
					[1, "#445566"],
				],
			},
		])
			expect(() => snapshotKanjiFrame({ ...frame, args } as never)).toThrow();
		for (const beats of [[1, 1], [2, 1], [-1], [NaN]])
			expect(() =>
				snapshotKanjiSong({ beats, bpm: 120, downbeatIndex0: 0 }),
			).toThrow();
	});
	test("existing ExtraBold800 is rejected when falsely labelled Bold700", async () => {
		const bytes = await readFile(
			new URL(
				"../../apps/web/public/motion-text/fonts/shippori-mincho-b1-extrabold.ttf",
				import.meta.url,
			),
		);
		const body = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		);
		expect(() =>
			titleRiffFontIdentity(body, "Shippori Mincho B1", 700),
		).toThrow("weight");
	});
	test("loads the entire four-script source only with explicit checkout", async () => {
		const root = process.env.ROCUT_TEST_MV_REFERENCE;
		if (!root)
			throw Error("Provide ROCUT_TEST_MV_REFERENCE for original source test");
		const reference = await loadKanjiSlamReference(root);
		expect(reference.scripts).toHaveLength(4);
		for (const name of ["kanjiSlam", "typeCard", "tunnel"])
			expect(reference.scripts[3]!.code).toContain(`Z.scene('${name}',`);
		expect(reference.scripts[3]!.code).toContain("const artCache = new Map()");
		expect(reference.scripts[3]!.code).toContain("const beatCache = new Map()");
	});
});
