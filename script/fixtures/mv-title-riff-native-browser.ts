import type {
	TitleRiffFont,
	TitleRiffReference,
} from "./mv-title-riff-reference-contract";
import type { MvEmberCommand } from "../../packages/editor-contracts/src/mv-ember-plan";
import { createTitleRiffReference } from "./mv-title-riff-reference-browser";
import {
	titleRiffTestFrame,
	titleRiffTestSong,
} from "./mv-title-riff-reference-cases";
import { titleRiffTestImages } from "./mv-title-riff-reference-image-fixtures";
import {
	titleRiffNativeResources,
	titleRiffNativeSample,
	titleRiffNativeSource,
} from "./mv-title-riff-native-source";
import {
	captureTitleRiff,
	originalTitleRiffPixels,
} from "./mv-title-riff-native-capture";
import { check, difference } from "./mv-afterimage-capture";
import { display } from "./mv-type-card-pixels";
import { exportTitleRiff } from "./mv-title-riff-native-export";
import { verifyTitleRiffEmptyBounds } from "./mv-title-riff-native-font-bounds";
import { diagnoseTitleRiffRaster } from "./mv-title-riff-native-diagnostic";
import { titleRiffDifferenceLocations } from "./mv-title-riff-native-difference";
import { traceTitleRiffText } from "./mv-title-riff-native-text-trace";

const scope = globalThis as typeof globalThis & {
	__titleRiffReference: TitleRiffReference;
	__titleRiffFonts: readonly (Omit<TitleRiffFont, "body"> & { url: string })[];
	__titleRiffNativeResult?: unknown;
	__titleRiffNativeProgress?: unknown;
	__titleRiffExportEnabled: boolean;
	__titleRiffDiagnosticEnabled: boolean;
	__writeTitleRiffOraclePng?: (frame: number, base64: string) => Promise<void>;
};
async function run() {
	const observations: Record<string, ReturnType<typeof difference>> = {};
	const negatives: Record<string, ReturnType<typeof difference>> = {};
	const provenance: unknown[] = [],
		violations: string[] = [];
	const diagnostics: Record<string, unknown> = {};
	const mismatchLocations: Record<string, unknown> = {};
	const textTraces: Record<string, unknown> = {};
	const progress = {
		current: "assets",
		observations,
		negatives,
		violations,
		diagnostics,
		mismatchLocations,
		textTraces,
		emptyFontBounds: undefined as unknown,
	};
	scope.__titleRiffNativeProgress = progress;
	const fonts = await Promise.all(
		scope.__titleRiffFonts.map(async ({ url, ...metadata }) => {
			const response = await fetch(url);
			check(response.ok, `Actual font fixture HTTP ${response.status}`);
			return { ...metadata, body: await response.arrayBuffer() };
		}),
	);
	const images = await titleRiffTestImages(),
		song = titleRiffTestSong();
	const resources = titleRiffNativeResources(fonts, images);
	progress.current = "actual-font-empty-bounds";
	const emptyFontBounds = await verifyTitleRiffEmptyBounds(resources);
	progress.emptyFontBounds = emptyFontBounds;
	const oracle = await createTitleRiffReference({
		reference: scope.__titleRiffReference,
		song,
		fonts,
		images,
	});
	let repeats = 0;
	const compare = (
		label: string,
		actual: Uint8ClampedArray,
		expected: Uint8ClampedArray,
		exact = false,
	) => {
		const diff = difference(actual, expected);
		observations[label] = diff;
		if (exact ? diff.max !== 0 : diff.max > 2 || diff.mae >= 0.025)
			violations.push(label);
		return diff;
	};
	try {
		for (const [variant, times] of [
			[
				"intro",
				[
					9.13, 2.25, 2.5, 3.98, 4.03, 4.5, 5.03, 5.46, 6, 6.066, 6.071, 6.5,
					7.1, 8.49, 8.8, 10.06, 12.2, 9.13, 4.03,
				],
			],
			[
				"outro",
				[
					25.13, 20.25, 20.5, 21.52, 22.03, 22.53, 22.96, 24.49, 24.8, 25.52,
					26.52, 27.5, 28.02, 29.5, 25.13, 21.52,
				],
			],
		] as const) {
			const input = titleRiffTestFrame(variant),
				source = titleRiffNativeSource(input, song, resources);
			const firstFrames = new Map<number, Uint8ClampedArray>();
			for (const time of times) {
				const index = Math.round((time - input.shotStart) * 60),
					label = `${variant}-${index}`;
				progress.current = label;
				const actual = await captureTitleRiff(source, resources, index);
				const expected = await originalTitleRiffPixels(
					oracle,
					titleRiffNativeSample(input, index),
				);
				const prior = firstFrames.get(index);
				if (prior) {
					compare(`${label}-repeat`, actual, prior, true);
					repeats++;
				} else firstFrames.set(index, actual);
				const diff = compare(label, actual, expected.pixels);
				if (!prior && (diff.max > 2 || diff.mae >= 0.025))
					mismatchLocations[label] = titleRiffDifferenceLocations(
						actual,
						expected.pixels,
					);
				if (!prior && (diff.max > 2 || diff.mae >= 0.025))
					textTraces[label] = await traceTitleRiffText(
						oracle,
						titleRiffNativeSample(input, index),
						source,
						resources,
						index,
						actual,
						expected.pixels,
					);
				if (
					scope.__titleRiffDiagnosticEnabled &&
					!prior &&
					(diff.max > 2 || diff.mae >= 0.025)
				) {
					progress.current = `${label}-raster-diagnosis`;
					diagnostics[label] = await diagnoseTitleRiffRaster(
						source,
						resources,
						index,
						expected.pixels,
					);
				}
				if (time === times[0] || diff.max > 2) {
					display(actual, expected.pixels, `${variant} native frame ${index}`);
					if (time === times[0]) provenance.push(expected.provenance);
				}
			}
			// Both samples precede title lock, when the monument print screen
			// is actually visible. Outro frame293 has no circleBatch at all.
			const index = variant === "intro" ? 230 : 163;
			progress.current = `${variant}-negative-controls`;
			const baseline = await captureTitleRiff(source, resources, index);
			const unmodified = await captureTitleRiff(source, resources, index, {
				controlled: true,
			});
			compare(`${variant}-controlled-vs-public`, unmodified, baseline, true);
			for (const omitted of ["text", "circleBatch"] as const) {
				let removed = 0;
				const changed = await captureTitleRiff(source, resources, index, {
					mutate: (data) => {
						const commands = data.commands.flatMap<MvEmberCommand>(
							(command) => {
								if (command.kind === omitted) {
									removed++;
									return [];
								}
								if (command.kind !== "surface") return [command];
								return [
									{
										...command,
										commands: command.commands.filter((child) => {
											if (child.kind === omitted) {
												removed++;
												return false;
											}
											return true;
										}),
									},
								];
							},
						);
						Reflect.set(data, "commands", commands);
					},
				});
				const diff = difference(changed, baseline);
				negatives[`${variant}-omitted-${omitted}`] = diff;
				check(
					removed > 0 && diff.changed > 0,
					`Omitted ${omitted} must be visible in ${variant}`,
				);
			}
			const shifted = titleRiffNativeSource(
				input,
				{ ...song, beats: song.beats.map((time) => time + 0.125) },
				resources,
			);
			negatives[`${variant}-wrong-clock`] = difference(
				await captureTitleRiff(shifted, resources, index),
				baseline,
			);
			check(
				negatives[`${variant}-wrong-clock`]!.changed > 0,
				"Wrong clock must be visible",
			);
		}
		check(repeats >= 4, "Both intro/outro require nonmonotonic repeats");
		let exported;
		if (scope.__titleRiffExportEnabled && violations.length === 0) {
			check(
				scope.__writeTitleRiffOraclePng,
				"Missing bounded titleRiff oracle artifact sink",
			);
			exported = await exportTitleRiff(
				oracle,
				song,
				resources,
				scope.__writeTitleRiffOraclePng,
				(event) => {
					progress.current = event.current;
					scope.__titleRiffNativeProgress = { ...progress, export: event };
				},
			);
		}
		return {
			...exported,
			passed: violations.length === 0,
			observations,
			negatives,
			violations,
			diagnostics,
			mismatchLocations,
			textTraces,
			repeats,
			provenance,
			emptyFontBounds,
			thresholds: {
				maxChannelAtMost: 2,
				maeLessThan: 0.025,
				sameBackendReplayMax: 0,
			},
			imageFixtureScope:
				"Verified encoded synthetic images, not original film artwork",
			originalSource:
				"Unmodified complete titleRiff draw including original clock; excludes external INTRO.post/gl.js",
			exportTested: !!exported,
			groupMasterPostTested: false,
			installedElectronTested: false,
		};
	} finally {
		oracle.dispose();
	}
}
void run().then(
	(result) => {
		scope.__titleRiffNativeResult = result;
	},
	(error) => {
		scope.__titleRiffNativeResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: scope.__titleRiffNativeProgress,
		};
	},
);
