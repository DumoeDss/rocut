import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	verifyUiExportAudio,
	verifyUiExportPicture,
} from "./probe-ui-export-samples.mjs";

export function verifyUiFormatMedia(
	output,
	{ width, height, numerator, denominator },
) {
	const streams = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-of",
				"json",
				output.path,
			],
			{ windowsHide: true, encoding: "utf8" },
		),
	).streams;
	const stream = streams.find((item) => item.codec_type === "video");
	assert(stream, "download must contain a video stream");
	assert.equal(streams.filter((item) => item.codec_type === "video").length, 1);
	const audioStreams = streams.filter((item) => item.codec_type === "audio");
	assert.equal(
		audioStreams.length,
		1,
		"real UI export must preserve the source audio",
	);
	const audio = audioStreams[0];
	assert.equal(audio.codec_name, "aac");
	assert.equal(stream.codec_name, "h264");
	assert.equal(stream.width, width);
	assert.equal(stream.height, height);
	// Each case starts from the original two-second timeline via actual Undo.
	// Earlier-frame endpoint alignment yields 59 frames at 30000/1001.
	const expectedFrames = Math.floor((2 * numerator) / denominator);
	const expectedDuration = (expectedFrames * denominator) / numerator;
	assert.equal(Number(stream.nb_read_frames), expectedFrames);
	const [rateNum, rateDen] = stream.avg_frame_rate.split("/").map(Number);
	assert(
		Math.abs(rateNum / rateDen - numerator / denominator) < 0.01,
		"encoded FPS must match selected rational rate",
	);
	assert(
		Math.abs(
			Number(stream.duration) - (expectedFrames * denominator) / numerator,
		) < 0.003,
		"video duration must match its frame count",
	);
	assert(
		Math.abs(Number(audio.start_time ?? 0) - Number(stream.start_time ?? 0)) <
			0.05,
		"audio/video start offset must stay bounded",
	);
	assert(
		Math.abs(Number(audio.duration) - expectedDuration) < 0.05,
		"AAC duration must follow the retimed project endpoint",
	);
	const audioSamples = verifyUiExportAudio({
		path: output.path,
		expectedDuration,
	});
	const samples = verifyUiExportPicture({ path: output.path, expectedFrames });
	return {
		file: output.path,
		suggestedFilename: output.suggestedFilename,
		width,
		height,
		fps: { numerator, denominator },
		frames: expectedFrames,
		duration: Number(stream.duration),
		samples,
		audio: {
			codec: audio.codec_name,
			duration: Number(audio.duration),
			samples: audioSamples,
		},
	};
}
