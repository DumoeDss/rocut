import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function probeExportMedia(ffprobe, path) {
	const { stdout } = await run(
		ffprobe,
		[
			"-v",
			"error",
			"-count_frames",
			"-show_entries",
			"stream=codec_type,width,height,r_frame_rate,sample_rate,start_time,duration,nb_read_frames",
			"-show_entries",
			"format=duration",
			"-of",
			"json",
			path,
		],
		{ maxBuffer: 16 * 1024 * 1024, timeout: 120000, windowsHide: true },
	);
	return JSON.parse(stdout);
}

function finite(value, name) {
	if (
		(typeof value !== "string" && typeof value !== "number") ||
		(typeof value === "string" && value.trim() === "") ||
		!Number.isFinite(Number(value))
	)
		throw new Error("Missing or invalid measured " + name);
	return Number(value);
}

function positiveInteger(value, name) {
	const number = finite(value, name);
	if (!Number.isSafeInteger(number) || number <= 0)
		throw new Error("Invalid positive integer " + name);
	return number;
}

export function exportMediaFacts(probe) {
	const videos = probe.streams.filter(
		(stream) => stream.codec_type === "video",
	);
	const audios = probe.streams.filter(
		(stream) => stream.codec_type === "audio",
	);
	if (videos.length !== 1 || audios.length !== 1)
		throw new Error("Export must have exactly one video and one audio stream");
	const [video] = videos,
		[audio] = audios;
	const parts = String(video.r_frame_rate).split("/");
	if (parts.length !== 2)
		throw new Error("Missing measured rational frame rate");
	const fpsNumerator = positiveInteger(parts[0], "fps numerator");
	const fpsDenominator = positiveInteger(parts[1], "fps denominator");
	const rate = fpsNumerator / fpsDenominator;
	const videoStart = finite(video.start_time, "video start time");
	const audioStart = finite(audio.start_time, "audio start time");
	const videoDuration = finite(video.duration, "video duration");
	const audioDuration = finite(audio.duration, "audio duration");
	if (videoDuration <= 0 || audioDuration <= 0)
		throw new Error("Non-positive stream duration");
	// Container duration alone can hide a shorter stream or a nonzero start.
	// These are stream-boundary measurements, not content/lip-sync evidence.
	const startOffset = Math.abs(audioStart - videoStart);
	const endOffset = Math.abs(
		audioStart + audioDuration - videoStart - videoDuration,
	);
	return {
		width: positiveInteger(video.width, "width"),
		height: positiveInteger(video.height, "height"),
		fpsNumerator,
		fpsDenominator,
		frameCount: positiveInteger(
			video.nb_read_frames,
			"decoded video frame count",
		),
		videoStreams: videos.length,
		audioStreams: audios.length,
		audioVideoOffsetFrames: Math.max(startOffset, endOffset) * rate,
		audioVideoStartOffsetFrames: startOffset * rate,
		audioVideoEndOffsetFrames: endOffset * rate,
		alignmentScope: "stream-boundaries-not-content-sync",
	};
}
