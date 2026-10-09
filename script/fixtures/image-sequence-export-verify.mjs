import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const WIDTH = 64,
	HEIGHT = 36,
	FRAMES = 6,
	RGB_BYTES = WIDTH * HEIGHT * 3;
const TRIM = 5005,
	WRONG_TRIM = 10010;

/** Deliberately independent of browser reference helpers and the Rust resolver.
 * 120k ticks/s, 30000/1001 timeline, 24000/1001 source sequence, rate 1.
 */
function expected(frame, trim) {
	const active = frame >= 1 && frame < 5;
	const ordinal = active
		? Math.min(
				221,
				Number(
					((BigInt(trim) + BigInt(frame - 1) * 4004n) * 24000n) /
						(120000n * 1001n),
				),
			)
		: null;
	const color =
		ordinal === null
			? [0, 0, 0]
			: [ordinal, ((ordinal * 7) % 200) + 20, ((ordinal * 13) % 200) + 20];
	const pixel = (x, y) =>
		!active ? [0, 0, 0] : x < 48 ? color : y < 18 ? [128, 0, 0] : [0, 0, 0];
	return { ordinal, pixel };
}

function measureFrame(rgb, frame, trim) {
	assert.equal(rgb.length, RGB_BYTES);
	const oracle = expected(frame, trim);
	let max = 0,
		total = 0;
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const expectedPixel = oracle.pixel(x, y),
				at = (y * WIDTH + x) * 3;
			for (let channel = 0; channel < 3; channel++) {
				const error = Math.abs(rgb[at + channel] - expectedPixel[channel]);
				max = Math.max(max, error);
				total += error;
			}
		}
	}
	const regions = [
		{ name: "opaque-sequence", x0: 2, x1: 46, y0: 2, y1: 34 },
		{ name: "half-alpha-over-black", x0: 50, x1: 62, y0: 2, y1: 16 },
		{ name: "transparent-over-black", x0: 50, x1: 62, y0: 20, y1: 34 },
	].map(({ name, x0, x1, y0, y1 }) => {
		const sum = [0, 0, 0],
			reference = oracle.pixel(x0, y0);
		for (let y = y0; y < y1; y++)
			for (let x = x0; x < x1; x++)
				for (let channel = 0; channel < 3; channel++)
					sum[channel] += rgb[(y * WIDTH + x) * 3 + channel];
		const count = (x1 - x0) * (y1 - y0),
			mean = sum.map((value) => value / count);
		return {
			name,
			mean,
			channelErrors: mean.map((value, channel) =>
				Math.abs(value - reference[channel]),
			),
		};
	});
	return {
		frame,
		ordinal: oracle.ordinal,
		max,
		mae: total / RGB_BYTES,
		regions,
	};
}

function acceptable(measurement) {
	return (
		measurement.max <= 12 &&
		measurement.mae <= 3 &&
		measurement.regions.every((region) =>
			region.channelErrors.every((error) => error <= 3),
		)
	);
}

function decode(file, ffmpeg, ffprobe) {
	const options = {
		windowsHide: true,
		timeout: 20000,
		maxBuffer: 4 * 1024 * 1024,
	};
	const metadata = JSON.parse(
		execFileSync(
			ffprobe,
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_frames",
				"-of",
				"json",
				file,
			],
			options,
		),
	);
	assert.equal(
		metadata.streams.length,
		1,
		"Sequence fixture must contain video only",
	);
	const track = metadata.streams[0];
	assert.equal(track.codec_type, "video");
	assert.equal(track.width, WIDTH);
	assert.equal(track.height, HEIGHT);
	assert.equal(Number(track.nb_read_frames), FRAMES);
	assert.equal(
		track.avg_frame_rate,
		"30000/1001",
		"NTSC frame rate was rounded",
	);
	const times = metadata.frames
		.filter((frame) => frame.media_type === "video")
		.map((frame) => Number(frame.best_effort_timestamp_time));
	assert.equal(times.length, FRAMES);
	times.forEach((time, index) => {
		assert.ok(
			Number.isFinite(time) &&
				Math.abs(time - (index * 1001) / 30000) <= 0.0011,
			`NTSC timestamp differs at ${index}: ${time}`,
		);
		if (index)
			assert.ok(
				time > times[index - 1],
				"Duplicate/nonmonotonic encoded timestamp",
			);
	});
	const rgb = execFileSync(
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
		options,
	);
	assert.equal(
		rgb.length,
		FRAMES * RGB_BYTES,
		"Independent decoder did not return all six frames",
	);
	const bytes = readFileSync(file);
	return {
		rgb,
		summary: {
			frames: FRAMES,
			width: WIDTH,
			height: HEIGHT,
			codec: track.codec_name,
			frameRate: track.avg_frame_rate,
			frameTimes: times,
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		},
	};
}

/** Read-only all-frame verification; never trusts a rendered image as its oracle. */
export function verifyImageSequenceExport({
	file,
	wrongTrimFile,
	ffmpeg,
	ffprobe,
}) {
	const correct = decode(file, ffmpeg, ffprobe),
		wrong = decode(wrongTrimFile, ffmpeg, ffprobe);
	assert.notEqual(
		correct.summary.sha256,
		wrong.summary.sha256,
		"Negative-control movie duplicates the correct export",
	);
	const observations = [],
		wrongTrimObservations = [],
		rejectedFrames = [];
	for (let frame = 0; frame < FRAMES; frame++) {
		const slice = (rgb) =>
			rgb.subarray(frame * RGB_BYTES, (frame + 1) * RGB_BYTES);
		const good = measureFrame(slice(correct.rgb), frame, TRIM);
		assert.ok(
			acceptable(good),
			`Decoded sequence frame ${frame} differs: ${JSON.stringify(good)}`,
		);
		observations.push(good);
		const negativeSelf = measureFrame(slice(wrong.rgb), frame, WRONG_TRIM);
		assert.ok(
			acceptable(negativeSelf),
			`Wrong-trim movie is not the declared counterexample at ${frame}: ${JSON.stringify(negativeSelf)}`,
		);
		const negative = measureFrame(slice(wrong.rgb), frame, TRIM);
		if (!acceptable(negative)) rejectedFrames.push(frame);
		wrongTrimObservations.push({
			frame,
			ownOracle: negativeSelf,
			correctOracle: negative,
		});
	}
	assert.deepEqual(
		rejectedFrames,
		[1, 2, 3, 4],
		"Encoded gate must reject every active wrong-trim frame and accept both blank boundaries",
	);
	return {
		passed: true,
		correct: { ...correct.summary, observations },
		wrongTrimControl: {
			...wrong.summary,
			observations: wrongTrimObservations,
			rejectedFrames,
		},
		oracle:
			"Independent integer NTSC/trim-to-ordinal math and authored RGB/straight-alpha-over-black contract; no Rust plan or sampled render used as reference",
		scope: {
			gpuSceneExporterFrames: 12,
			ffmpegDecodeTested: true,
			rgbaCompositingTested: true,
			alphaInEncodedTrackTested: false,
			hostImportTested: false,
			installedElectronTested: false,
		},
	};
}
