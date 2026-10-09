import { createFlameOracle } from "./mv-flame-oracle";
import { flameOracleAssets } from "./mv-flame-oracle-assets";
import type { FlameReference, FlameSong } from "./mv-flame-oracle-contract";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";

declare global {
	interface Window {
		__flameOriginalReference: FlameReference;
		__flameOriginalResult?: unknown;
	}
}
const scope = window;
const check = ({
	condition,
	message,
}: {
	condition: boolean;
	message: string;
}) => {
	if (!condition) throw Error(message);
};
async function run() {
	const resources = await flameOracleAssets();
	const song: FlameSong = {
		bpm: 120,
		downbeatIndex0: 0,
		beats: Array.from({ length: 40 }, (_, i) => i / 2),
		stops: [{ kind: "stop", start: 5.2, end: 5.6 }],
		envelope: {
			fps: 4,
			vocal: Array.from({ length: 64 }, (_, i) => (i % 7) / 7),
		},
	};
	const oracle = await createFlameOracle({
		reference: scope.__flameOriginalReference,
		song,
		resources,
	});
	const observations = [],
		hashes = new Map<string, string>();
	let preparedHash: string | undefined;
	try {
		for (const mode of ["breathe", "grow", "dark"] as const) {
			for (const time of [5.4, 4.003, 7.98, 5.6, 4.003]) {
				const frame = { shotStart: 4, duration: 4, time, args: { mode } };
				const actual = oracle.render(frame);
				try {
					const sha256 = await digest(Uint8Array.from(actual.pixels).buffer);
					const key = `${mode}/${time}`,
						prior = hashes.get(key);
					check({
						condition: !prior || prior === sha256,
						message: "Whole original Flame random-seek repeat changed",
					});
					hashes.set(key, sha256);
					if (actual.prepared) {
						check({
							condition:
								actual.prepared.width === 960 &&
								actual.prepared.height === 1600,
							message: "Original prepared dimensions changed",
						});
						const hash = await digest(
							Uint8Array.from(actual.prepared.pixels).buffer,
						);
						check({
							condition: !preparedHash || preparedHash === hash,
							message:
								"Original diffusion/feather cache changed across modes/seeks",
						});
						preparedHash = hash;
						const edge = 0,
							center = (632 * 960 + 588) * 4;
						check({
							condition: actual.prepared.pixels[edge + 3] === 0,
							message: "Original feather did not remove image edge",
						});
						check({
							condition: actual.prepared.pixels[center] < 220,
							message:
								"Original diffusion did not replace the painted flame core",
						});
					} else
						check({
							condition: mode === "dark",
							message: "Hands mode did not expose original preprocessing",
						});
					observations.push({
						mode,
						time,
						sha256,
						repeat: !!prior,
						prepared: !!actual.prepared,
					});
				} finally {
					actual.canvas.width = actual.canvas.height = 1;
				}
			}
		}
		let rejected = false;
		try {
			oracle.render({
				shotStart: 4,
				duration: 4,
				time: 4.3,
				args: { flameAt: [580, 632, 662, 150, 235, 46] },
			});
		} catch (error) {
			rejected = String(error).includes("fresh original realm");
		}
		check({
			condition: rejected,
			message: "Changed landmark cache guard was not observed",
		});
		return {
			passed: true,
			observations,
			preparedHash,
			changedLandmarksRejected: rejected,
			scripts: scope.__flameOriginalReference.scripts.map(({ id, sha256 }) => ({
				id,
				sha256,
			})),
			images: resources.map(({ resource }) => resource),
			scope:
				"Original oracle helper only; not native Flame/preprocess parity or export acceptance",
		};
	} finally {
		oracle.dispose();
	}
}
void run().then(
	(result) => {
		scope.__flameOriginalResult = result;
	},
	(error) => {
		scope.__flameOriginalResult = {
			passed: false,
			error: String(error?.stack ?? error),
		};
	},
);
