import type { FallReference } from "./mv-fall-contract";
import { fallCases } from "./mv-fall-cases";
import { createFallOracle } from "./mv-fall-oracle";
import {
	fallCharacter,
	fallAnalysis,
	fallSample,
	fallSource,
} from "./mv-fall-source";
import { captureFall } from "./mv-fall-capture";
import { fallNegatives, fallParity } from "./mv-fall-negatives";
import { check, difference } from "./mv-afterimage-capture";
import { display } from "./mv-type-card-pixels";
import { titleRiffDifferenceLocations } from "./mv-title-riff-native-difference";
import { exportFall } from "./mv-fall-export";

const scope = globalThis as typeof globalThis & {
	__fallReference: FallReference;
	__fallResult?: unknown;
	__fallProgress?: unknown;
	__fallExportEnabled: boolean;
	__writeFallOraclePng?: (frame: number, base64: string) => Promise<void>;
};
async function run() {
	const observations: Record<string, unknown> = {},
		violations: string[] = [],
		locations: Record<string, unknown> = {};
	const progress = { current: "assets", observations, violations, locations };
	scope.__fallProgress = progress;
	const advance = (s: string) => {
		progress.current = s;
	};
	const character = await fallCharacter();
	let repeats = 0;
	let negatives: unknown;
	const provenance: unknown[] = [];
	for (const item of fallCases()) {
		const resources = [
			character,
			...(item.song.stops ? [await fallAnalysis(item.song)] : []),
		];
		const source = fallSource(item.frame, item.song, resources);
		const oracle = await createFallOracle(
			scope.__fallReference,
			item.song,
			character,
		);
		const prior = new Map<number, Uint8ClampedArray>();
		try {
			for (const index of item.indices) {
				const key = `${item.label}/${index}`;
				advance(key);
				const actual = await captureFall(source, resources, index);
				const expected = oracle.render(fallSample(item.frame, index));
				try {
					const diff = difference(actual, expected.pixels);
					observations[key] = diff;
					if (!fallParity(diff)) {
						violations.push(key);
						locations[key] = titleRiffDifferenceLocations(
							actual,
							expected.pixels,
						);
					}
					const previous = prior.get(index);
					if (previous) {
						const repeat = difference(actual, previous);
						observations[`${key}/repeat`] = repeat;
						check(repeat.max === 0, `Fall nondeterministic ${key}`);
						repeats++;
					} else prior.set(index, actual);
					if (item.defaults && [0, 120, 200].includes(index) && !previous) {
						const implicit = oracle.render(fallSample(item.frame, index), true);
						try {
							const diff = difference(implicit.pixels, expected.pixels);
							observations[`${key}/implicit-default-character`] = diff;
							check(diff.max === 0, "Original Fall character default mismatch");
						} finally {
							implicit.canvas.width = implicit.canvas.height = 1;
						}
					}
					if (index === item.indices[0]) {
						display(actual, expected.pixels, `Fall ${item.label}`);
						provenance.push(expected.provenance);
					}
				} finally {
					expected.canvas.width = expected.canvas.height = 1;
				}
			}
			if (item.label === "default" && violations.length === 0)
				negatives = await fallNegatives(source, resources, advance);
		} finally {
			oracle.dispose();
		}
	}
	check(
		repeats === fallCases().length,
		"Every Fall case needs nonmonotonic repeat proof",
	);
	let exported;
	if (scope.__fallExportEnabled && violations.length === 0) {
		check(scope.__writeFallOraclePng, "Missing Fall oracle PNG artifact sink");
		exported = await exportFall(
			scope.__fallReference,
			character,
			scope.__writeFallOraclePng,
			advance,
		);
	}
	return {
		...exported,
		passed: violations.length === 0,
		observations,
		violations,
		locations,
		negatives,
		repeats,
		provenance,
		thresholds: { maxChannelAtMost: 2, maeLessThan: 0.025, repeatMax: 0 },
		exportTested: !!exported,
		installedElectronTested: false,
		groupMasterPostTested: false,
	};
}
void run().then(
	(result) => {
		scope.__fallResult = result;
	},
	(error) => {
		scope.__fallResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: scope.__fallProgress,
		};
	},
);
