import type { InkReference } from "./mv-ink-contract";
import { inkCases } from "./mv-ink-cases";
import { createInkImage } from "./mv-ink-assets";
import { inkResource, inkNativeSource } from "./mv-ink-native-source";
import { createInkOracle } from "./mv-ink-oracle";
import { inkDigest } from "./mv-ink-oracle-realm";
import { inkSample } from "./mv-ink-source";
import { captureInk } from "./mv-ink-capture";
import { inkNegatives } from "./mv-ink-negatives";
import { check, difference } from "./mv-afterimage-capture";
declare global {
	interface Window {
		__inkNativeReference: InkReference;
		__inkNativeProgress?: unknown;
		__inkNativeResult?: unknown;
	}
}
async function run() {
	const observations: unknown[] = [],
		violations: string[] = [],
		provenance: unknown[] = [];
	const progress = { current: "assets", observations, violations };
	window.__inkNativeProgress = progress;
	let repeats = 0;
	let negatives: unknown;
	for (const item of inkCases()) {
		const image = await createInkImage({ variant: item.assetVariant }),
			resources = [inkResource(image)];
		const source = inkNativeSource({
			frame: item.frame,
			song: item.song,
			resources,
		});
		const oracle = await createInkOracle({
			reference: window.__inkNativeReference,
			song: item.song,
			images: [image],
		});
		const prior = new Map<number, string>();
		try {
			for (const [visit, index] of item.indices.entries()) {
				const key = `${item.label}/${visit}/${index}`;
				progress.current = key;
				const actual = await captureInk({ source, resources, index });
				const expected = oracle.render(inkSample({ frame: item.frame, index }));
				try {
					const diff = difference(actual, expected.pixels);
					observations.push({ key, ...diff });
					if (!(diff.max <= 2 && diff.mae < 0.025)) violations.push(key);
					const hash = await inkDigest(actual.slice().buffer),
						old = prior.get(index);
					if (old) {
						check(old === hash, `Ink nondeterministic ${key}`);
						repeats++;
					} else prior.set(index, hash);
					if (visit === 0) provenance.push(expected.provenance);
				} finally {
					expected.canvas.width = expected.canvas.height = 1;
				}
			}
			if (
				item.label === "defaults-nine-tendrils-and-helix" &&
				violations.length === 0
			) {
				progress.current = "independent-command-negatives";
				negatives = await inkNegatives({ source, resources, index: 180 });
			}
		} finally {
			oracle.dispose();
		}
	}
	check(
		observations.length === 408 && repeats === 48,
		"Ink complete matrix/repeats missing",
	);
	return {
		passed: violations.length === 0 && !!negatives,
		observations,
		violations,
		repeats,
		provenance,
		negatives,
		thresholds: { maxChannelAtMost: 2, maeLessThan: 0.025, repeatMax: 0 },
		exportTested: false,
		installedElectronTested: false,
		groupMasterPostTested: false,
	};
}
void run().then(
	(result) => {
		window.__inkNativeResult = result;
	},
	(error) => {
		window.__inkNativeResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: window.__inkNativeProgress,
		};
	},
);
