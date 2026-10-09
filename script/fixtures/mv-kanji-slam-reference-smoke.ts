import type {
	KanjiSlamFont,
	KanjiSlamReference,
	KanjiSlamFrame,
} from "./mv-kanji-slam-reference-contract";
import { createKanjiSlamReference } from "./mv-kanji-slam-reference-browser";
import {
	kanjiSlamTestFrame,
	kanjiSlamTestSong,
	KANJI_SAMPLES,
} from "./mv-kanji-slam-reference-cases";
import { titleRiffTestImages } from "./mv-title-riff-reference-image-fixtures";
import { kanjiDigest } from "./mv-kanji-slam-reference-realm";

const scope = globalThis as typeof globalThis & {
	__kanjiReference: KanjiSlamReference;
	__kanjiFonts: readonly (Omit<KanjiSlamFont, "body"> & { url: string })[];
	__kanjiOracleResult?: unknown;
	__kanjiOracleProgress?: string;
};
const assert = (condition: unknown, message: string) => {
	if (!condition) throw Error(message);
};
async function main() {
	scope.__kanjiOracleProgress = "loading-explicit-fonts";
	const fonts = await Promise.all(
		scope.__kanjiFonts.map(async ({ url, ...metadata }) => {
			const response = await fetch(url);
			if (!response.ok)
				throw Error(`Local fixture font HTTP ${response.status}`);
			return { ...metadata, body: await response.arrayBuffer() };
		}),
	);
	const images = (await titleRiffTestImages()).filter(
		(image) => image.id !== "dawn.png",
	);
	const song = kanjiSlamTestSong(),
		reference = scope.__kanjiReference,
		input = { reference, song, fonts, images };
	const hashes: Record<string, string> = {},
		provenance: unknown[] = [],
		negatives: string[] = [],
		boundaryCases: unknown[] = [];
	let repeats = 0,
		observerChecks = 0;
	const capture = async (
		oracle: Awaited<ReturnType<typeof createKanjiSlamReference>>,
		label: string,
		frame: KanjiSlamFrame,
		counter?: string,
		show = false,
	) => {
		scope.__kanjiOracleProgress = label;
		const result = await oracle.render(frame, counter !== undefined);
		try {
			const data = result.canvas
				.getContext("2d")!
				.getImageData(0, 0, 1920, 1080).data;
			const hash = await kanjiDigest(data.buffer as ArrayBuffer);
			if (hashes[label]) {
				assert(
					hashes[label] === hash,
					`Nonmonotonic original differs: ${label}`,
				);
				repeats++;
			}
			hashes[label] = hash;
			if (counter)
				assert(
					result.textCalls.includes(counter),
					`Original HUD expected ${counter} for ${label}, got ${JSON.stringify(result.textCalls)}`,
				);
			if (show) {
				const heading = document.createElement("h2"),
					canvas = document.createElement("canvas");
				heading.textContent = label;
				canvas.width = 480;
				canvas.height = 270;
				canvas.getContext("2d")!.drawImage(result.bitmap, 0, 0, 480, 270);
				document.body.append(heading, canvas);
				provenance.push(result.provenance);
			}
			return { hash, provenance: result.provenance };
		} finally {
			result.bitmap.close();
			result.canvas.width = result.canvas.height = 1;
		}
	};
	const reject = async (label: string, work: () => Promise<unknown>) => {
		scope.__kanjiOracleProgress = label;
		let rejected = false;
		try {
			await work();
		} catch {
			rejected = true;
		}
		assert(rejected, `Expected explicit rejection: ${label}`);
		negatives.push(label);
	};
	for (const variant of ["default", "night", "hand"] as const) {
		const oracle = await createKanjiSlamReference(input);
		try {
			for (const sample of KANJI_SAMPLES)
				await capture(
					oracle,
					`${variant}-${sample.label}`,
					kanjiSlamTestFrame(variant, sample.time),
					sample.counter,
					sample.label === "small-kana-first",
				);
			for (const index of [0, 2, 11]) {
				const sample = KANJI_SAMPLES[index]!;
				await capture(
					oracle,
					`${variant}-${sample.label}`,
					kanjiSlamTestFrame(variant, sample.time),
					sample.counter,
				);
			}
			const unobserved = await capture(
				oracle,
				`${variant}-unobserved`,
				kanjiSlamTestFrame(variant, 4.8),
			);
			assert(
				unobserved.hash === hashes[`${variant}-small-kana-first`],
				"Transparent HUD observation must not change pixels",
			);
			observerChecks++;
			for (const key of ["char", "bg"] as const)
				await reject(`${variant}-missing-${key}`, async () => {
					const frame = kanjiSlamTestFrame(variant, 4.8);
					const result = await oracle.render({
						...frame,
						args: { ...frame.args, [key]: "missing.png" },
					});
					result.bitmap.close();
					result.canvas.width = result.canvas.height = 1;
				});
		} finally {
			oracle.dispose();
		}
	}
	assert(
		repeats === 9 && observerChecks === 3,
		"All three original variants need nonmonotonic and observation-neutrality checks",
	);
	assert(
		new Set(Object.values(hashes)).size >= 36,
		"Original scene sequence unexpectedly static",
	);
	// Independent expected HUD counts; never recompute or replace private shotBeats.
	for (const [label, index, beat, count] of [
		["lower-outside", 8, 3.954999, 8],
		["lower-at", 8, 3.955, 8],
		["lower-inside", 8, 3.955001, 8],
		["snap-at", 8, 4.045, 8],
		["snap-outside", 8, 4.045001, 9],
		["tail-inside", 16, 7.954999, 9],
		["tail-at", 16, 7.955, 8],
		["tail-outside", 16, 7.955001, 8],
	] as const) {
		const beats = [...song.beats];
		beats[index] = beat;
		const oracle = await createKanjiSlamReference({
			...input,
			song: { ...song, beats },
		});
		try {
			const value = await capture(
				oracle,
				label,
				kanjiSlamTestFrame("default", 4),
				`01 / ${String(count).padStart(2, "0")}`,
			);
			boundaryCases.push({
				label,
				beat,
				expectedCount: count,
				hash: value.hash,
				songIdentity: value.provenance.songIdentity,
			});
		} finally {
			oracle.dispose();
		}
	}
	assert(
		hashes["lower-outside"] !== hashes["lower-at"],
		"The inclusive -45 ms boundary must affect the original flash clock",
	);
	assert(
		hashes["snap-at"] !== hashes["snap-outside"],
		"The +45 ms start insertion must affect the original HUD",
	);
	assert(
		hashes["tail-inside"] !== hashes["tail-at"],
		"The exclusive end -45 ms boundary must affect the original HUD",
	);
	await reject("missing-font", async () => {
		(
			await createKanjiSlamReference({ ...input, fonts: fonts.slice(1) })
		).dispose();
	});
	await reject("wrong-real-font-bytes", async () => {
		const wrong = fonts.map((f, i) =>
			i === 2
				? {
						...f,
						body: fonts[0]!.body,
						byteLength: fonts[0]!.byteLength,
						sha256: fonts[0]!.sha256,
					}
				: f,
		);
		(await createKanjiSlamReference({ ...input, fonts: wrong })).dispose();
	});
	await reject("changed-original-source", async () => {
		const altered = structuredClone(reference);
		(altered.scripts[3] as { code: string }).code += "\n";
		(
			await createKanjiSlamReference({ ...input, reference: altered })
		).dispose();
	});
	for (const key of ["width", "hasTransparency"] as const)
		await reject(`wrong-decoded-${key}`, async () => {
			const altered = images.map((image, i) =>
				i
					? image
					: { ...image, [key]: key === "width" ? image.width + 1 : false },
			);
			(await createKanjiSlamReference({ ...input, images: altered })).dispose();
		});
	const changed = await createKanjiSlamReference({
		...input,
		song: {
			...song,
			beats: song.beats.map((beat, i) => (i === 9 ? 4.625 : beat)),
		},
	});
	try {
		const value = await capture(
			changed,
			"changed-whole-song-clock",
			kanjiSlamTestFrame("default", 4.545),
			"01 / 08",
		);
		assert(
			value.hash !== hashes["default-beat-plus-45ms"],
			"Actual source clock must affect the original drawing",
		);
		negatives.push("changed-source-clock-is-observable");
	} finally {
		changed.dispose();
	}
	return {
		passed: true,
		originalOracleOnly: true,
		rocutSceneParityTested: false,
		exportTested: false,
		groupMasterPostTested: false,
		samples: Object.keys(hashes).length,
		repeats,
		observerChecks,
		boundaryCases,
		negatives,
		hashes,
		provenance,
		imageFixtureScope:
			"Encoded synthetic marker character/sky images, not original film art",
		scope:
			"Full original kanjiSlam draw including default/night/hand+fire, no external post pipeline",
	};
}
void main().then(
	(result) => {
		scope.__kanjiOracleResult = result;
	},
	(error) => {
		scope.__kanjiOracleResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: scope.__kanjiOracleProgress,
		};
	},
);
