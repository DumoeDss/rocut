import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Independent decoder checks, using the authored layer geometry and no Rocut
 * pixel/timing helpers. White pixels can only originate in native lyrics. */
export function verifyMixedEngineLyrics({ artifact, ffmpeg, ffprobe }) {
	const native = {
		windowsHide: true,
		timeout: 20000,
		maxBuffer: 4 * 1024 * 1024,
	};
	const data = [];
	for (const name of ["without-foreground", "with-foreground"]) {
		const file = join(artifact, name + ".webm");
		const metadata = JSON.parse(
			execFileSync(
				ffprobe,
				["-v", "error", "-count_frames", "-show_streams", "-of", "json", file],
				native,
			),
		);
		const video = metadata.streams.find(
			(stream) => stream.codec_type === "video",
		);
		assert.equal(video?.nb_read_frames, "6");
		assert.equal(video?.width, 96);
		assert.equal(video?.height, 96);
		assert.equal(video?.r_frame_rate, "25/1");
		writeFileSync(
			join(artifact, name + ".ffprobe.json"),
			JSON.stringify(metadata, null, 2),
		);
		const pixels = execFileSync(
			ffmpeg,
			[
				"-v",
				"error",
				"-i",
				file,
				"-map",
				"0:v:0",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			],
			native,
		);
		writeFileSync(join(artifact, name + ".rgb24"), pixels);
		data.push(pixels);
		execFileSync(
			ffmpeg,
			[
				"-v",
				"error",
				"-i",
				file,
				"-frames:v",
				"1",
				join(artifact, name + ".png"),
			],
			native,
		);
	}
	const rgb = (body, frame, x, y) => [
		...body.subarray(
			(frame * 96 * 96 + y * 96 + x) * 3,
			(frame * 96 * 96 + y * 96 + x) * 3 + 3,
		),
	];
	const white = (color) => color.every((value) => value > 175);
	const close = (actual, expected, label) =>
		assert.ok(
			actual.every(
				(value, channel) => Math.abs(value - expected[channel]) <= 9,
			),
			`${label}: ${actual} expected ${expected}`,
		);
	const frames = [],
		masks = [];
	for (let frame = 0; frame < 6; frame++) {
		const sourceFrame = 10 + frame,
			mask = [];
		let baselineLyrics = 0,
			occludedLyrics = 0,
			visibleLyrics = 0,
			outsideChanged = 0;
		for (let y = 20; y < 76; y++)
			for (let x = 4; x < 92; x++) {
				const original = rgb(data[0], frame, x, y),
					composed = rgb(data[1], frame, x, y);
				const isGlyph = white(original);
				mask.push(isGlyph);
				if (!isGlyph) continue;
				baselineLyrics++;
				if (x >= 42 && x <= 53 && y >= 34 && y <= 61) {
					if (
						!white(composed) &&
						composed[0] > 180 &&
						composed[1] < 120 &&
						composed[2] < 140
					)
						occludedLyrics++;
				} else if (x < 37 || x > 58 || y < 29 || y > 66) {
					if (white(composed)) visibleLyrics++;
					else outsideChanged++;
				}
			}
		for (const [i, body] of data.entries()) {
			close(
				rgb(body, frame, 90, 80),
				[20 + sourceFrame * 2, 30, 70],
				`HF background ${i}/${frame}`,
			);
			close(
				rgb(body, frame, sourceFrame * 2 + 4, 12),
				[60, 214, 145],
				`Remotion moving marker ${i}/${frame}`,
			);
		}
		close(
			rgb(data[1], frame, 48, 34),
			[233, 69, 96],
			`Recipe foreground ${frame}`,
		);
		frames.push({
			frame,
			sourceFrame,
			baselineLyrics,
			occludedLyrics,
			visibleLyrics,
			outsideChanged,
		});
		masks.push(mask);
	}
	const changedGlyphPixels = masks[0].reduce(
		(sum, value, index) => sum + Number(value !== masks[5][index]),
		0,
	);
	const result = {
		frames,
		changedGlyphPixels,
		decodedFrames: 6,
		canvas: [96, 96],
		fps: 25,
	};
	writeFileSync(
		join(artifact, "decode-measurements.json"),
		JSON.stringify(result, null, 2),
	);
	for (const frame of frames) {
		assert.ok(
			frame.baselineLyrics > 30,
			`Native glyphs missing ${JSON.stringify(frame)}`,
		);
		assert.ok(
			frame.occludedLyrics >= 5,
			`Foreground did not occlude native glyphs ${JSON.stringify(frame)}`,
		);
		assert.ok(
			frame.visibleLyrics >= 15,
			`Foreground covered all glyphs or alpha was lost ${JSON.stringify(frame)}`,
		);
		assert.ok(
			frame.outsideChanged <= 8,
			`Foreground unexpectedly damaged outside glyphs ${JSON.stringify(frame)}`,
		);
	}
	assert.ok(
		changedGlyphPixels > 20,
		`Native SYNC/BEAT cue transition missing ${changedGlyphPixels}`,
	);
	return result;
}
