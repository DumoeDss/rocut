import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	verifyUiExportAudio,
	verifyUiExportPicture,
} from "./probe-ui-export-samples.mjs";

export function verifyUiExportOptions(output, { format, includeAudio }) {
	const metadata = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_format",
				"-show_packets",
				"-show_entries",
				"packet=stream_index,pts_time,duration_time",
				"-of",
				"json",
				output.path,
			],
			{ windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
		),
	);
	const videos = metadata.streams.filter(
		(stream) => stream.codec_type === "video",
	);
	const audios = metadata.streams.filter(
		(stream) => stream.codec_type === "audio",
	);
	assert.equal(videos.length, 1);
	assert.equal(
		audios.length,
		includeAudio ? 1 : 0,
		"Include audio checkbox must control the actual encoded tracks",
	);
	assert(
		output.suggestedFilename.endsWith("." + format),
		"download name must match the selected format",
	);
	assert(
		metadata.format.format_name.includes(format === "webm" ? "webm" : "mp4"),
	);
	const video = videos[0];
	assert.equal(video.codec_name, format === "webm" ? "vp9" : "h264");
	assert.equal(video.width, 1920);
	assert.equal(video.height, 1080);
	assert.equal(Number(video.nb_read_frames), 60);
	const picturePackets = metadata.packets
		.filter((packet) => packet.stream_index === video.index)
		.map((packet) => Number(packet.pts_time))
		.sort((a, b) => a - b);
	assert.equal(picturePackets.length, 60);
	// Matroska timestamps use millisecond precision; validate every presentation time.
	for (let frame = 0; frame < 60; frame++)
		assert(
			Math.abs(picturePackets[frame] - frame / 30) < 0.002,
			"each encoded picture must retain its selected timing",
		);
	assert(
		Math.abs(Number(metadata.format.duration) - 2) < 0.05,
		"container duration must retain the full timeline",
	);
	const picture = verifyUiExportPicture({
		path: output.path,
		expectedFrames: 60,
	});
	let audio = null;
	if (includeAudio) {
		const stream = audios[0];
		assert.equal(stream.codec_name, format === "webm" ? "opus" : "aac");
		const packets = metadata.packets.filter(
			(packet) => packet.stream_index === stream.index,
		);
		const first = Math.min(...packets.map((packet) => Number(packet.pts_time)));
		const last = Math.max(
			...packets.map(
				(packet) => Number(packet.pts_time) + Number(packet.duration_time),
			),
		);
		assert(
			Math.abs(first - picturePackets[0]) < 0.05,
			"audio/video start offset must stay bounded",
		);
		assert(
			Math.abs(last - 2) < 0.05,
			"audio tail must end at the timeline endpoint within codec padding",
		);
		audio = {
			codec: stream.codec_name,
			start: first,
			end: last,
			samples: verifyUiExportAudio({ path: output.path, expectedDuration: 2 }),
		};
	}
	return {
		file: output.path,
		filename: output.suggestedFilename,
		bytes: Number(metadata.format.size),
		videoCodec: video.codec_name,
		picture,
		audio,
	};
}
