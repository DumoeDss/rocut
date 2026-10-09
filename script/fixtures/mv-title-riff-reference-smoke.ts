import type { TitleRiffFont, TitleRiffReference } from "./mv-title-riff-reference-contract";
import { createTitleRiffReference } from "./mv-title-riff-reference-browser";
import { titleRiffTestFrame, titleRiffTestSong } from "./mv-title-riff-reference-cases";
import { titleRiffTestImages } from "./mv-title-riff-reference-image-fixtures";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";

const scope = globalThis as typeof globalThis & {
	__titleRiffReference: TitleRiffReference;
	__titleRiffFonts: readonly (Omit<TitleRiffFont, "body"> & { url: string })[];
	__titleRiffOracleResult?: unknown;
	__titleRiffOracleProgress?: string;
};
const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
async function main() {
	scope.__titleRiffOracleProgress = "load-explicit-local-fonts";
	const fonts = await Promise.all(scope.__titleRiffFonts.map(async ({ url, ...metadata }) => {
		const response = await fetch(url); if (!response.ok) throw Error(`Local fixture font HTTP ${response.status}`);
		return { ...metadata, body: await response.arrayBuffer() };
	}));
	const images = await titleRiffTestImages(), song = titleRiffTestSong(), reference = scope.__titleRiffReference;
	const input = { reference, song, fonts, images };
	const oracle = await createTitleRiffReference(input);
	const hashes: Record<string, string> = {}, provenance: unknown[] = [], negatives: string[] = [];
	let repeats = 0;
	const capture = async (owner: typeof oracle, label: string, variant: "intro" | "outro", time: number, show = false) => {
		scope.__titleRiffOracleProgress = label;
		const result = await owner.render(titleRiffTestFrame(variant, time));
		try {
			const bytes = result.canvas.getContext("2d")!.getImageData(0, 0, 1920, 1080).data;
			const hash = await convergeReferenceDigest(bytes.buffer as ArrayBuffer);
			if (hashes[label]) { assert(hashes[label] === hash, `Nonmonotonic repeat differs: ${label}`); repeats++; }
			hashes[label] = hash;
			if (show) {
				const heading = document.createElement("h2"), canvas = document.createElement("canvas");
				heading.textContent = label; canvas.width = 480; canvas.height = 270;
				canvas.getContext("2d")!.drawImage(result.bitmap, 0, 0, 480, 270); document.body.append(heading, canvas);
				provenance.push(result.provenance);
			}
			return { hash, provenance: result.provenance };
		} finally { result.bitmap.close(); result.canvas.width = result.canvas.height = 1; }
	};
	const reject = async (label: string, work: () => Promise<unknown>) => {
		scope.__titleRiffOracleProgress = label;
		let failed = false; try { await work(); } catch { failed = true; }
		assert(failed, `Expected original oracle rejection: ${label}`); negatives.push(label);
	};
	try {
		for (const [variant, times] of [
			["intro", [9.13, 2.25, 2.5, 3.98, 4.03, 4.5, 5.03, 5.46, 6, 6.066, 6.071, 6.5, 7.1, 8.49, 8.8, 9.13, 10.06, 12.2, 4.03]],
			["outro", [25.13, 20.25, 20.5, 21.52, 22.03, 22.53, 22.96, 24.49, 24.8, 25.52, 26.52, 27.5, 28.02, 29.5, 25.13, 21.52]],
		] as const) for (const time of times) await capture(oracle, `${variant}-${time}`, variant, time, (time === 9.13 || time === 25.13) && !hashes[`${variant}-${time}`]);
		assert(repeats === 4, "Both variants require independent early/late nonmonotonic repeats");
		assert(new Set(Object.values(hashes)).size > 24, "Complete original sequence must not be a static text substitute");
		const clockFrame = await capture(oracle, "clock-baseline", "intro", 9.13);
		assert(clockFrame.provenance.clock.phase > 0 && clockFrame.provenance.clock.phase < 1, "Original clock phase must not be invented as zero");
		await reject("missing-hidden-recap-image", async () => {
			const frame = structuredClone(titleRiffTestFrame("outro", 20.25));
			(frame.args.recap![2] as { bg: string }).bg = "not-declared.png";
			const result = await oracle.render(frame); result.bitmap.close(); result.canvas.width = result.canvas.height = 1;
		});
		await reject("missing-silhouette-image", async () => {
			const frame = structuredClone(titleRiffTestFrame("intro", 2.25));
			(frame.args as { char: string }).char = "not-declared.png";
			const result = await oracle.render(frame); result.bitmap.close(); result.canvas.width = result.canvas.height = 1;
		});
	} finally { oracle.dispose(); }
	await reject("missing-real-font", async () => { (await createTitleRiffReference({ ...input, fonts: fonts.slice(1) })).dispose(); });
	await reject("wrong-real-font-bytes", async () => {
		const wrong = fonts.map((font) => font.family === "Zen Kaku Gothic New" ? { ...font, body: fonts[0]!.body, byteLength: fonts[0]!.byteLength, sha256: fonts[0]!.sha256 } : font);
		(await createTitleRiffReference({ ...input, fonts: wrong })).dispose();
	});
	await reject("changed-original-source", async () => {
		const changed = structuredClone(reference); (changed.scripts[3] as { code: string }).code += "\n";
		(await createTitleRiffReference({ ...input, reference: changed })).dispose();
	});
	for (const field of ["width", "hasTransparency"] as const) await reject(`wrong-decoded-${field}`, async () => {
		const altered = images.map((image, i) => i ? image : { ...image, [field]: field === "width" ? image.width + 1 : false });
		(await createTitleRiffReference({ ...input, images: altered })).dispose();
	});
	const changedClock = await createTitleRiffReference({ ...input, song: { ...song, beats: song.beats.map((t) => t + 0.125), downbeatIndex0: 6 } });
	try {
		const changed = await capture(changedClock, "changed-source-clock", "intro", 9.13);
		assert(changed.hash !== hashes["clock-baseline"], "Changing authored song clock must change the reference, not reuse a fixed clock");
		negatives.push("changed-source-clock-is-observable");
	} finally { changedClock.dispose(); }
	return { passed: true, originalOracleOnly: true, rocutSceneParityTested: false, exportTested: false,
		groupMasterPostTested: false, samples: Object.keys(hashes).length, repeats, negatives, hashes, provenance,
		imageFixtureScope: "Encoded synthetic marker images with verified intrinsic dimensions and alpha; not original film art" };
}
void main().then((result) => { scope.__titleRiffOracleResult = result; }, (error) => {
	scope.__titleRiffOracleResult = { passed: false, error: String(error?.stack ?? error), progress: scope.__titleRiffOracleProgress };
});
