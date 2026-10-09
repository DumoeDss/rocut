import assert from "node:assert/strict";
import { join } from "node:path";

/** Independent ffmpeg pixels, compared with screenshots of the visible editor.
 * The preview is CSS-scaled and the export is lossy; pixel hashes are not a
 * meaningful cross-path criterion. Thresholds are fixed before the export. */
export function compareFusionFrames(run, video, artifacts) {
	const samples = [
		{ name: "retro", frame: 30 },
		{ name: "retro-second", frame: 90 },
		{ name: "particles", frame: 150 },
		{ name: "peel", frame: 195 },
		{ name: "three", frame: 255 },
	];
	return samples.map(({ name, frame }) => {
		const actual = run("ffmpeg.exe", [
			"-v",
			"error",
			"-i",
			video,
			"-vf",
			`select=eq(n\\,${frame}),scale=320:180`,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		]);
		const expected = run("ffmpeg.exe", [
			"-v",
			"error",
			"-i",
			join(artifacts, `preview-${name}.png`),
			"-vf",
			"scale=320:180",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		]);
		assert.equal(actual.length, 320 * 180 * 3);
		assert.equal(expected.length, actual.length);
		let absolute = 0,
			squared = 0,
			referenceSquared = 0,
			mean = 0,
			referenceMean = 0;
		let red = 0,
			blue = 0,
			teal = 0,
			white = 0;
		for (let i = 0; i < actual.length; i += 3) {
			const [r, g, b] = actual.subarray(i, i + 3);
			if (r > 130 && r > g * 1.4 && r > b * 1.4) red++;
			if (b > 130 && b > r * 1.5 && b > g * 1.3) blue++;
			if (g > 75 && b > 75 && r < g * 0.6) teal++;
			if (r > 205 && g > 205 && b > 205) white++;
			for (let c = 0; c < 3; c++) {
				absolute += Math.abs(actual[i + c] - expected[i + c]);
				mean += actual[i + c];
				referenceMean += expected[i + c];
				squared += actual[i + c] ** 2;
				referenceSquared += expected[i + c] ** 2;
			}
		}
		const count = actual.length / 3,
			mae = absolute / actual.length;
		const contrast = Math.sqrt(
			squared / actual.length - (mean / actual.length) ** 2,
		);
		const referenceContrast = Math.sqrt(
			referenceSquared / actual.length - (referenceMean / actual.length) ** 2,
		);
		assert(mae < 15, `${name} visible-preview/export mean RGB error ${mae}`);
		assert(
			contrast / referenceContrast > 0.75 &&
				contrast / referenceContrast < 1.25,
			`${name} export must retain visible preview contrast`,
		);
		assert(
			white / count > 0.012,
			`${name} native lyrics must remain visible above the scene`,
		);
		if (name === "retro")
			assert(red / count > 0.3, "Retro poster must survive export");
		if (name === "particles")
			assert(teal / count > 0.025, "Particle logo must survive export");
		if (name === "peel")
			assert(
				red / count > 0.025 && blue / count > 0.15,
				"Peel must contain both A and B",
			);
		if (name === "three")
			assert(
				white / count > 0.02,
				"Native lyrics and ASCII strokes must survive export",
			);
		return {
			name,
			frame,
			meanRgbError: mae,
			contrastRatio: contrast / referenceContrast,
			redFraction: red / count,
			blueFraction: blue / count,
			tealFraction: teal / count,
			whiteFraction: white / count,
		};
	});
}
