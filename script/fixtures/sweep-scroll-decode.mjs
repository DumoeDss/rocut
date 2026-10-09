import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function decodeSweepScroll(artifacts, ffmpegDirectory) {
	assert(isAbsolute(artifacts) && isAbsolute(ffmpegDirectory));
	return ["ascii-sweep", "particle-scroll", "overlay"].map((name) => {
		const directory = join(artifacts, name),
			movie = join(directory, "generators.webm");
		const options = {
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 16 * 1024 * 1024,
		};
		const metadata = JSON.parse(
			execFileSync(
				join(ffmpegDirectory, "ffprobe.exe"),
				[
					"-v",
					"error",
					"-count_frames",
					"-show_streams",
					"-show_format",
					"-of",
					"json",
					movie,
				],
				{ ...options, encoding: "utf8" },
			),
		);
		const track = metadata.streams.find((s) => s.codec_type === "video");
		assert(
			track &&
				track.width === 384 &&
				track.height === 216 &&
				track.nb_read_frames === "6",
		);
		assert.equal(track.codec_name, "vp9");
		assert.equal(track.r_frame_rate, "30/1");
		const actual = execFileSync(
			join(ffmpegDirectory, "ffmpeg.exe"),
			[
				"-v",
				"error",
				"-i",
				movie,
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"pipe:1",
			],
			options,
		);
		const expected = readFileSync(join(directory, "expected.rgba")),
			stride = 384 * 216 * 4;
		assert.equal(actual.length, stride * 6);
		assert.equal(expected.length, actual.length);
		const metrics = [];
		for (let frame = 0; frame < 6; frame++) {
			let error = 0,
				pixels = 0,
				detailError = 0,
				actualContrast = 0,
				expectedContrast = 0,
				motion = 0;
			for (let p = 0; p < stride; p += 4) {
				const i = frame * stride + p;
				for (let c = 0; c < 4; c++) {
					error += Math.abs(actual[i + c] - expected[i + c]);
					motion += Math.abs(actual[i + c] - actual[p + c]);
				}
				const contrast = [16, 32, 48].reduce(
					(sum, background, c) => sum + Math.abs(expected[i + c] - background),
					0,
				);
				if (contrast <= 45) continue;
				pixels++;
				expectedContrast += contrast;
				for (let c = 0; c < 3; c++) {
					detailError += Math.abs(actual[i + c] - expected[i + c]);
					actualContrast += Math.abs(actual[i + c] - [16, 32, 48][c]);
				}
			}
			metrics.push({
				frame,
				meanRgbaError: error / stride,
				pixels,
				detailError: detailError / (pixels * 3),
				contrastRatio: actualContrast / expectedContrast,
				motion: motion / stride,
			});
		}
		const ok =
			metrics.every(
				(m) =>
					m.meanRgbaError < 10 &&
					m.pixels > 500 &&
					m.detailError < 25 &&
					m.contrastRatio > 0.7 &&
					m.contrastRatio < 1.3,
			) && metrics.at(-1).motion > 0.1;
		const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
		const evidence = {
			name,
			ok,
			decoder: "independent FFmpeg/FFprobe",
			metadata,
			metrics,
			videoSha256: sha(readFileSync(movie)),
			expectedSha256: sha(expected),
		};
		writeFileSync(
			join(directory, "independent-generator-decode.json"),
			JSON.stringify(evidence, null, 2) + "\n",
			{ flag: "wx", encoding: "utf8" },
		);
		assert(
			ok,
			`${name} independent foreground quality gate failed; report retained`,
		);
		return evidence;
	});
}
