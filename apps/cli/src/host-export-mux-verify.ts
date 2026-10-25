type Run = (
	executable: string,
	args: string[],
	maxBytes: number,
) => Promise<Buffer>;

/** Fully decodes final streams while keeping frame hashes, not a whole-song PCM allocation. */
export async function verifyNativeMuxOutput(input: {
	file: string;
	ffprobe: string;
	ffmpeg: string;
	run: Run;
	format: "mp4" | "webm";
	frames: number;
	samples: number;
	withAudio: boolean;
}) {
	const { file, ffprobe, ffmpeg, run, frames, samples } = input;
	const metadata = JSON.parse(
		(
			await run(
				ffprobe,
				[
					"-v",
					"error",
					"-count_frames",
					"-show_entries",
					"stream=codec_type,nb_read_frames,time_base,duration_ts",
					"-of",
					"json",
					file,
				],
				1024 * 1024,
			)
		).toString("utf8"),
	);
	const video = metadata.streams?.filter(
		(stream: { codec_type?: string }) => stream.codec_type === "video",
	);
	if (video?.length !== 1 || Number(video[0].nb_read_frames) !== frames)
		throw new Error("Final mux changed exact video frame coverage");
	if (!input.withAudio) return;
	const audio = metadata.streams?.filter(
		(stream: { codec_type?: string }) => stream.codec_type === "audio",
	);
	if (audio?.length !== 1)
		throw new Error("Final mux requires exactly one audio stream");
	if (
		input.format === "mp4" &&
		(audio[0].time_base !== "1/48000" ||
			Number(audio[0].duration_ts) !== samples)
	)
		throw new Error("Final mux changed exact audible MP4 sample duration");
	const decoded = (
		await run(
			ffmpeg,
			[
				"-v",
				"error",
				"-nostdin",
				"-i",
				file,
				"-map",
				"0:a:0",
				"-ac",
				"2",
				"-ar",
				"48000",
				"-af",
				"asetnsamples=n=4096:p=0",
				"-f",
				"framemd5",
				"pipe:1",
			],
			32 * 1024 * 1024,
		)
	).toString("utf8");
	let decodedSamples = 0;
	for (const line of decoded.split("\n"))
		if (line.trim() && !line.startsWith("#")) {
			const duration = Number(line.split(",")[3]?.trim());
			if (!Number.isSafeInteger(duration) || duration <= 0)
				throw new Error("Final mux decoder returned invalid audio coverage");
			decodedSamples += duration;
		}
	if (decodedSamples < samples || decodedSamples > samples + 8192)
		throw new Error("Final mux changed decoded audio sample coverage");
}
