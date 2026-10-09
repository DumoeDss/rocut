import type { ThreadReference } from "./mv-thread-contract";
import { threadCases } from "./mv-thread-cases";
import { createThreadOracle } from "./mv-thread-oracle";
import {
	threadHand,
	threadAnalysis,
	threadSample,
	threadSource,
} from "./mv-thread-source";
import { captureThread } from "./mv-thread-capture";
import { threadNegatives, threadParity } from "./mv-thread-negatives";
import { check, difference } from "./mv-afterimage-capture";
import { display } from "./mv-type-card-pixels";
import { titleRiffDifferenceLocations } from "./mv-title-riff-native-difference";
import { exportThread } from "./mv-thread-export";

const scope = globalThis as typeof globalThis & {
	__threadReference: ThreadReference;
	__threadResult?: unknown;
	__threadProgress?: unknown;
	__threadExportEnabled: boolean;
	__writeThreadOraclePng?: (frame: number, base64: string) => Promise<void>;
};
async function run() {
	const observations: Record<string, unknown> = {},
		violations: string[] = [],
		locations: Record<string, unknown> = {};
	const progress = { current: "assets", observations, violations, locations };
	scope.__threadProgress = progress;
	const advance = (s: string) => {
		progress.current = s;
	};
	const hand = await threadHand();
	let repeats = 0;
	let negatives: unknown;
	const provenance: unknown[] = [];
	for (const item of threadCases()) {
		const resources = [
			hand,
			...(item.song.stops ? [await threadAnalysis(item.song)] : []),
		];
		const source = threadSource(item.frame, item.song, resources);
		const oracle = await createThreadOracle(
			scope.__threadReference,
			item.song,
			hand,
		);
		const prior = new Map<number, Uint8ClampedArray>();
		try {
			for (const index of item.indices) {
				const key = `${item.label}/${index}`;
				advance(key);
				const actual = await captureThread(source, resources, index);
				const expected = oracle.render(threadSample(item.frame, index));
				try {
					const diff = difference(actual, expected.pixels);
					observations[key] = diff;
					if (!threadParity(diff)) {
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
						check(repeat.max === 0, `Thread nondeterministic ${key}`);
						repeats++;
					} else prior.set(index, actual);
					if (item.defaults && [0, 120, 200].includes(index) && !previous) {
						const implicit = oracle.render(
							threadSample(item.frame, index),
							true,
						);
						try {
							const diff = difference(implicit.pixels, expected.pixels);
							observations[`${key}/implicit-default-hand`] = diff;
							check(diff.max === 0, "Original Thread hand default mismatch");
						} finally {
							implicit.canvas.width = implicit.canvas.height = 1;
						}
					}
					if (index === item.indices[0]) {
						display(actual, expected.pixels, `Thread ${item.label}`);
						provenance.push(expected.provenance);
					}
				} finally {
					expected.canvas.width = expected.canvas.height = 1;
				}
			}
			if (item.label === "default" && violations.length === 0)
				negatives = await threadNegatives(source, resources, advance);
		} finally {
			oracle.dispose();
		}
	}
	check(
		repeats === threadCases().length,
		"Every Thread case needs nonmonotonic repeat proof",
	);
	let exported;
	if (scope.__threadExportEnabled && violations.length === 0) {
		check(
			scope.__writeThreadOraclePng,
			"Missing Thread oracle PNG artifact sink",
		);
		exported = await exportThread(
			scope.__threadReference,
			hand,
			scope.__writeThreadOraclePng,
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
		scope.__threadResult = result;
	},
	(error) => {
		scope.__threadResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: scope.__threadProgress,
		};
	},
);
