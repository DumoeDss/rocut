import type {
	TitleRiffFont,
	TitleRiffReference,
} from "./mv-title-riff-reference-contract";
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
import {
	recordingImages,
	titleRiffRecordingCases,
} from "./mv-title-riff-recording-cases";
import { check, difference } from "./mv-afterimage-capture";

const scope = globalThis as typeof globalThis & {
	__titleRiffReference: TitleRiffReference;
	__titleRiffFonts: readonly (Omit<TitleRiffFont, "body"> & { url: string })[];
	__titleRiffRecordingResult?: unknown;
	__titleRiffRecordingProgress?: unknown;
};
async function run() {
	const observations: Record<string, ReturnType<typeof difference>> = {};
	const violations: string[] = [],
		provenance: unknown[] = [];
	const progress = { current: "assets", observations, violations };
	scope.__titleRiffRecordingProgress = progress;
	const fonts = await Promise.all(
		scope.__titleRiffFonts.map(async ({ url, ...metadata }) => {
			const response = await fetch(url);
			check(response.ok, `Recording font HTTP ${response.status}`);
			return { ...metadata, body: await response.arrayBuffer() };
		}),
	);
	const base = await titleRiffTestImages(),
		song = titleRiffTestSong();
	for (const group of titleRiffRecordingCases()) {
		progress.current = `${group.name}/assets`;
		const images = await recordingImages(base, group.sizes);
		const resources = titleRiffNativeResources(fonts, images);
		const oracle = await createTitleRiffReference({
			reference: scope.__titleRiffReference,
			song,
			fonts,
			images,
		});
		const prior = new Map<string, Uint8ClampedArray>();
		try {
			for (const sample of group.samples) {
				const input = titleRiffTestFrame(sample.variant);
				const frame =
					sample.silhouetteCue === undefined
						? input
						: {
								...input,
								args: {
									...input.args,
									cues: { ...input.args.cues, sil: sample.silhouetteCue },
								},
							};
				const source = titleRiffNativeSource(frame, song, resources);
				const index = Math.round((sample.time - frame.shotStart) * 60);
				const label = `${group.name}/${sample.name}/${index}`;
				progress.current = label;
				const actual = await captureTitleRiff(source, resources, index);
				const expected = await originalTitleRiffPixels(
					oracle,
					titleRiffNativeSample(frame, index),
				);
				const diff = difference(actual, expected.pixels);
				observations[label] = diff;
				if (diff.max > 2 || diff.mae >= 0.025) violations.push(label);
				const key = `${sample.variant}/${index}/${sample.silhouetteCue ?? "default"}`;
				const previous = prior.get(key);
				if (previous) {
					const repeated = difference(actual, previous);
					observations[`${label}/native-repeat`] = repeated;
					if (repeated.max !== 0) violations.push(`${label}/native-repeat`);
				} else prior.set(key, actual);
				if (sample === group.samples[0])
					provenance.push({ group: group.name, oracle: expected.provenance });
			}
		} finally {
			oracle.dispose();
		}
	}
	return {
		passed: violations.length === 0,
		observations,
		violations,
		provenance,
		thresholds: {
			maxChannelAtMost: 2,
			maeLessThan: 0.025,
			sameBackendReplayMax: 0,
		},
		originalSource:
			"Unmodified complete titleRiff draw and clock; no observers or browser pin-limit overrides",
		imageFixtureScope:
			"Additional encoded marker sizes, not original film artwork",
		exportTested: false,
		installedElectronTested: false,
	};
}
void run().then(
	(result) => {
		scope.__titleRiffRecordingResult = result;
	},
	(error) => {
		scope.__titleRiffRecordingResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: scope.__titleRiffRecordingProgress,
		};
	},
);
