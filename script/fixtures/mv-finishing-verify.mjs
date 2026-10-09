import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

export function verifyFinishingExport({ file, ffmpeg, ffprobe }) {
	const options = {
		windowsHide: true,
		timeout: 20000,
		maxBuffer: 4 * 1024 * 1024,
	};
	const metadata = JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-count_frames", "-show_streams", "-of", "json", file],
			options,
		),
	);
	const track = metadata.streams.find(
		(stream) => stream.codec_type === "video",
	);
	assert.equal(track.width, 100);
	assert.equal(track.height, 100);
	assert.equal(Number(track.nb_read_frames), 6);
	const decoded = execFileSync(
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
	assert.equal(decoded.length, 6 * 100 * 100 * 3);
	// This is computed from authored colors/automation/placement, not from a
	// renderer-produced reference: center=(.2+.6*invert)*.8*.75+.8*.2*.75.
	const expected = [0, 107.1, 130.05, 153, 130.05, 0],
		observations = [];
	for (let frame = 0; frame < 6; frame++) {
		let centerError = 0,
			barError = 0,
			centerCount = 0,
			barCount = 0;
		for (let y = 0; y < 100; y++)
			for (let x = 0; x < 100; x++)
				for (let c = 0; c < 3; c++) {
					const value = decoded[((frame * 100 + y) * 100 + x) * 3 + c];
					if (y >= 20 && y < 80 && x >= 20 && x < 80) {
						centerError += Math.abs(value - expected[frame]);
						centerCount++;
					}
					if (y < 7 || y >= 93) {
						barError += value;
						barCount++;
					}
				}
		const centerMae = centerError / centerCount,
			barMae = barError / barCount;
		assert.ok(
			centerMae < 3,
			`Decoded finishing frame ${frame}: center MAE ${centerMae}`,
		);
		assert.ok(
			barMae < 2,
			`Decoded finishing frame ${frame}: black-bar MAE ${barMae}`,
		);
		observations.push({ frame, expected: expected[frame], centerMae, barMae });
	}
	return { frames: 6, codec: track.codec_name, observations };
}
