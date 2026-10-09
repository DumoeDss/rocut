import type { FlameReference } from "./mv-flame-oracle-contract";
import { flameCases } from "./mv-flame-cases";
import { flameAnalysis, flameSample, flameSource } from "./mv-flame-source";
import { flameOracleAssets } from "./mv-flame-oracle-assets";
import { createFlameOracle } from "./mv-flame-oracle";
import { captureFlame } from "./mv-flame-capture";
import { ImagePreprocessOwner } from "../../packages/editor-classic/src/services/renderer/programmatic/image-preprocess-owner";
import { check, difference } from "./mv-afterimage-capture";
import { flameNegatives, preparedFlame } from "./mv-flame-negatives";
import { flameNativeAsset } from "./mv-flame-native-assets";
import { flameSensitivity } from "./mv-flame-sensitivity";

declare global {
	interface Window {
		__flameNativeReference: FlameReference;
		__flameNativeProgress?: unknown;
		__flameNativeResult?: unknown;
	}
}
const scope = window;
async function run() {
	const observations: Record<string, unknown> = {},
		violations: string[] = [],
		provenance: unknown[] = [];
	const progress = { current: "assets", observations, violations };
	scope.__flameNativeProgress = progress;
	const images = await flameOracleAssets();
	const owner = new ImagePreprocessOwner();
	let repeats = 0;
	let preparedImages = 0;
	let negatives: unknown;
	let sensitivity: unknown;
	try {
		for (const item of flameCases()) {
			const caseImages = item.assetVariant
				? [
						await flameNativeAsset({
							base: images[0]!,
							variant: item.assetVariant,
						}),
						images[1]!,
					]
				: images;
			const resources = [...caseImages, await flameAnalysis(item.song)];
			const source = flameSource({
				frame: item.frame,
				song: item.song,
				resources: resources,
				options: {
					vocal: item.vocal,
				},
			});
			const oracle = await createFlameOracle({
				reference: scope.__flameNativeReference,
				song: item.song,
				resources: caseImages,
			});
			const prior = new Map<number, Uint8ClampedArray>();
			try {
				for (const index of item.indices) {
					const key = `${item.label}/${index}`;
					progress.current = key;
					const actual = await captureFlame({
						source: source,
						resources: resources,
						index: index,
						imagePreprocessOwner: owner,
					});
					const expected = oracle.render(
						flameSample({ frame: item.frame, index: index }),
					);
					try {
						const diff = difference(actual, expected.pixels);
						observations[key] = diff;
						if (!(diff.max <= 2 && diff.mae < 0.025)) violations.push(key);
						const previous = prior.get(index);
						if (previous) {
							const repeat = difference(actual, previous);
							observations[`${key}/repeat`] = repeat;
							check(repeat.max === 0, `Flame nondeterministic ${key}`);
							repeats++;
						} else prior.set(index, actual);
						if (index === item.indices[0]) provenance.push(expected.provenance);
						if (index === item.indices[0] && expected.prepared) {
							progress.current = `${key}/full-prepared-image`;
							const preparedSource = flameSource({
								frame: item.frame,
								song: item.song,
								resources: resources,
								options: {
									vocal: item.vocal,
									width: expected.prepared.width,
									height: expected.prepared.height,
								},
							});
							const prepared = await captureFlame({
								source: preparedSource,
								resources: resources,
								index: index,
								imagePreprocessOwner: undefined,
								control: { mutate: preparedFlame },
							});
							const diff = difference(prepared, expected.prepared.pixels);
							observations[`${key}/full-prepared-image`] = diff;
							if (!(diff.max <= 2 && diff.mae < 0.025))
								violations.push(`${key}/full-prepared-image`);
							preparedImages++;
						}
					} finally {
						expected.canvas.width = expected.canvas.height = 1;
					}
				}
				if (item.label === "breathe-default" && violations.length === 0) {
					progress.current = "independent-command-negatives";
					negatives = await flameNegatives({
						source: source,
						resources: resources,
						index: 120,
					});
					sensitivity = await flameSensitivity({
						reference: scope.__flameNativeReference,
						song: item.song,
						resources: caseImages,
						frame: flameSample({ frame: item.frame, index: 120 }),
					});
				}
			} finally {
				oracle.dispose();
			}
		}
	} finally {
		owner.dispose();
	}
	check(
		repeats === flameCases().length,
		"Every Flame case needs a nonmonotonic exact repeat",
	);
	return {
		passed: violations.length === 0,
		observations,
		violations,
		repeats,
		provenance,
		thresholds: { maxChannelAtMost: 2, maeLessThan: 0.025, repeatMax: 0 },
		preparedImageTested: preparedImages > 0,
		preparedImages,
		negativesTested: !!negatives,
		negatives,
		sensitivity,
		exportTested: false,
		installedElectronTested: false,
		groupMasterPostTested: false,
	};
}
void run().then(
	(result) => {
		scope.__flameNativeResult = result;
	},
	(error) => {
		scope.__flameNativeResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: scope.__flameNativeProgress,
		};
	},
);
