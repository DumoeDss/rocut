import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { createKanjiSlamReference } from "./mv-kanji-slam-reference-browser";
import { kanjiSlamTestFrame } from "./mv-kanji-slam-reference-cases";
import { KANJI_NATIVE_BOUNDARIES } from "./mv-kanji-slam-native-cases";
import { kanjiSlamNativeSource } from "./mv-kanji-slam-native-source";
import {
	captureKanjiSlam,
	originalKanjiSlamPixels,
} from "./mv-kanji-slam-native-capture";
import { check, difference } from "./mv-afterimage-capture";

export async function verifyKanjiSlamNativeBoundaries(
	input: Parameters<typeof createKanjiSlamReference>[0],
	resources: readonly ResolvedProgrammaticResource[],
	compare: (
		label: string,
		actual: Uint8ClampedArray,
		expected: Uint8ClampedArray,
		exact?: boolean,
	) => unknown,
	progress: (label: string) => void,
) {
	const proofs: unknown[] = [],
		originals = new Map<string, Uint8ClampedArray>();
	for (const boundary of KANJI_NATIVE_BOUNDARIES) {
		progress(`boundary/${boundary.label}`);
		const beats = [...input.song.beats];
		beats[boundary.beatIndex] = boundary.tick / 120000;
		const song = { ...input.song, beats },
			frame = kanjiSlamTestFrame("default", 4);
		// Original beatCache is keyed by shot identity, not the beat-array value.
		// Each changed whole-song clock gets its own unmodified original realm.
		const oracle = await createKanjiSlamReference({ ...input, song });
		try {
			const expected = await originalKanjiSlamPixels(oracle, frame, true);
			const counter = `01 / ${String(boundary.count).padStart(2, "0")}`;
			check(
				expected.textCalls.includes(counter),
				`Original boundary HUD must contain ${counter}`,
			);
			const unobserved = await originalKanjiSlamPixels(oracle, frame);
			compare(
				`boundary/${boundary.label}/observer`,
				expected.pixels,
				unobserved.pixels,
				true,
			);
			const source = kanjiSlamNativeSource(frame, song, resources);
			compare(
				`boundary/${boundary.label}`,
				await captureKanjiSlam(source, resources, 0),
				expected.pixels,
			);
			originals.set(boundary.label, expected.pixels);
			proofs.push({ ...boundary, counter, provenance: expected.provenance });
		} finally {
			oracle.dispose();
		}
	}
	for (const [before, after] of [
		["lower-outside", "lower-at"],
		["snap-at", "snap-outside"],
		["tail-inside", "tail-at"],
	] as const)
		check(
			difference(originals.get(before)!, originals.get(after)!).changed > 0,
			`Original boundary ${before}/${after} must be visible`,
		);
	return proofs;
}
