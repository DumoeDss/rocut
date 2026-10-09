import type {
	KanjiSlamFont,
	KanjiSlamReference,
	KanjiSlamFrame,
} from "./mv-kanji-slam-reference-contract";
import { createKanjiSlamReference } from "./mv-kanji-slam-reference-browser";
import {
	kanjiSlamTestFrame,
	kanjiSlamTestSong,
} from "./mv-kanji-slam-reference-cases";
import { titleRiffTestImages } from "./mv-title-riff-reference-image-fixtures";
import {
	kanjiSlamNativeResources,
	kanjiSlamNativeSample,
	kanjiSlamNativeSource,
} from "./mv-kanji-slam-native-source";
import {
	captureKanjiSlam,
	originalKanjiSlamPixels,
} from "./mv-kanji-slam-native-capture";
import {
	KANJI_NATIVE_SAMPLES,
	kanjiSlamExplicitCases,
} from "./mv-kanji-slam-native-cases";
import { createKanjiSlamDefaultsControl } from "./mv-kanji-slam-native-defaults";
import { verifyKanjiSlamNativeBoundaries } from "./mv-kanji-slam-native-boundaries";
import {
	kanjiNativeParity,
	kanjiSlamNegativeControls,
} from "./mv-kanji-slam-native-negatives";
import { exportKanjiSlam } from "./mv-kanji-slam-native-export";
import { check, difference } from "./mv-afterimage-capture";
import { display } from "./mv-type-card-pixels";
import { titleRiffDifferenceLocations } from "./mv-title-riff-native-difference";

const scope = globalThis as typeof globalThis & {
	__kanjiSlamReference: KanjiSlamReference;
	__kanjiSlamFonts: readonly (Omit<KanjiSlamFont, "body"> & { url: string })[];
	__kanjiSlamNativeResult?: unknown;
	__kanjiSlamNativeProgress?: unknown;
	__kanjiSlamExportEnabled: boolean;
	__writeKanjiSlamOraclePng?: (frame: number, base64: string) => Promise<void>;
};
async function run() {
	const observations: Record<string, ReturnType<typeof difference>> = {},
		negatives: Record<string, unknown> = {};
	const provenance: unknown[] = [],
		violations: string[] = [],
		defaultsProof: unknown[] = [];
	const mismatchLocations: Record<string, unknown> = {};
	const progress = {
		current: "assets",
		observations,
		negatives,
		violations,
		mismatchLocations,
		defaultsProof,
	};
	scope.__kanjiSlamNativeProgress = progress;
	const advance = (label: string) => {
		progress.current = label;
	};
	const fonts = await Promise.all(
		scope.__kanjiSlamFonts.map(async ({ url, ...metadata }) => {
			const response = await fetch(url);
			check(
				response.ok,
				`Actual kanjiSlam font fixture HTTP ${response.status}`,
			);
			return { ...metadata, body: await response.arrayBuffer() };
		}),
	);
	const images = (await titleRiffTestImages()).filter(
		(image) => image.id !== "dawn.png",
	);
	const song = kanjiSlamTestSong(),
		resources = kanjiSlamNativeResources(fonts, images);
	const input = { reference: scope.__kanjiSlamReference, song, fonts, images };
	const oracle = await createKanjiSlamReference(input);
	let defaults:
		| Awaited<ReturnType<typeof createKanjiSlamDefaultsControl>>
		| undefined;
	let repeats = 0;
	const compare = (
		label: string,
		actual: Uint8ClampedArray,
		expected: Uint8ClampedArray,
		exact = false,
	) => {
		const diff = difference(actual, expected);
		observations[label] = diff;
		if (exact ? diff.max !== 0 : !kanjiNativeParity(diff))
			violations.push(label);
		return diff;
	};
	try {
		defaults = await createKanjiSlamDefaultsControl(input);
		const compareFrames = async (
			label: string,
			frame: KanjiSlamFrame,
			indices: readonly number[],
			proveDefaults: boolean,
		) => {
			const source = kanjiSlamNativeSource(frame, song, resources),
				firstFrames = new Map<number, Uint8ClampedArray>();
			let displayed = false;
			for (const index of indices) {
				const key = `${label}/${index}`;
				advance(key);
				const sampled = kanjiSlamNativeSample(frame, index);
				const actual = await captureKanjiSlam(source, resources, index),
					expected = await originalKanjiSlamPixels(oracle, sampled);
				const prior = firstFrames.get(index);
				if (prior) {
					compare(`${key}/repeat`, actual, prior, true);
					repeats++;
				} else firstFrames.set(index, actual);
				const diff = compare(key, actual, expected.pixels);
				if (!prior && !kanjiNativeParity(diff))
					mismatchLocations[key] = titleRiffDifferenceLocations(
						actual,
						expected.pixels,
					);
				if (!displayed && (index === indices[0] || !kanjiNativeParity(diff))) {
					display(actual, expected.pixels, `${label} native frame ${index}`);
					provenance.push(expected.provenance);
					displayed = true;
				}
				if (!prior && proveDefaults && [0, 48, 131].includes(index)) {
					advance(`${key}/original-defaults`);
					const implicit = await defaults!.render(sampled);
					compare(
						`${key}/original-defaults-vs-explicit`,
						implicit.pixels,
						expected.pixels,
						true,
					);
					defaultsProof.push({
						label,
						index,
						args: implicit.args,
						scripts: implicit.scripts,
					});
				}
			}
			return source;
		};
		for (const variant of ["default", "night", "hand"] as const) {
			const frame = kanjiSlamTestFrame(variant, 4);
			const source = await compareFrames(
				variant,
				frame,
				KANJI_NATIVE_SAMPLES,
				true,
			);
			const controls = await kanjiSlamNegativeControls(
				frame,
				song,
				source,
				resources,
				advance,
			);
			observations[`${variant}/controlled-vs-public`] = controls.controlled;
			Object.assign(negatives, controls.negatives);
		}
		for (const item of kanjiSlamExplicitCases())
			await compareFrames(item.label, item.input, item.indices, false);
		check(
			repeats >= 14,
			"Three defaults and every explicit branch require nonmonotonic repeat equality",
		);
		check(
			defaultsProof.length === 9,
			"Each original default must be proved at three visible times",
		);
		defaults.dispose();
		defaults = undefined;
		const boundaryCases = await verifyKanjiSlamNativeBoundaries(
			input,
			resources,
			compare,
			advance,
		);
		let exported;
		if (scope.__kanjiSlamExportEnabled && violations.length === 0) {
			check(
				scope.__writeKanjiSlamOraclePng,
				"Missing bounded kanjiSlam oracle artifact sink",
			);
			exported = await exportKanjiSlam(
				oracle,
				song,
				resources,
				scope.__writeKanjiSlamOraclePng,
				(event) => {
					advance(event.current);
					scope.__kanjiSlamNativeProgress = { ...progress, export: event };
				},
			);
		}
		return {
			...exported,
			passed: violations.length === 0,
			observations,
			negatives,
			violations,
			mismatchLocations,
			repeats,
			provenance,
			defaultsProof,
			boundaryCases,
			thresholds: {
				maxChannelAtMost: 2,
				maeLessThan: 0.025,
				sameBackendReplayMax: 0,
			},
			imageFixtureScope:
				"Verified encoded synthetic character/sky images, not original film artwork",
			originalSource:
				"Unmodified complete typo.js kanjiSlam with original clock; excludes external typo.post/gl.js",
			exportTested: !!exported,
			groupMasterPostTested: false,
			installedElectronTested: false,
		};
	} finally {
		defaults?.dispose();
		oracle.dispose();
	}
}
void run().then(
	(result) => {
		scope.__kanjiSlamNativeResult = result;
	},
	(error) => {
		scope.__kanjiSlamNativeResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: scope.__kanjiSlamNativeProgress,
		};
	},
);
