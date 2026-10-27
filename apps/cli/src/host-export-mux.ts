import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExportOptions } from "./host-export";
import type { NativeExportRecord } from "./host-export-native";
import { runNativeMediaProcess } from "./programmatic/native-media-process";
import { verifyNativeMuxOutput } from "./host-export-mux-verify";

type SegmentBytes = { record: NativeExportRecord; bytes: Uint8Array };
const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const quality = { low: 35, medium: 28, high: 20, very_high: 15 };
/** Platform codec work only. Rust admits the exact contiguous frame/sample contract. */
export async function muxNativeExport(input: {
	options: ExportOptions;
	signal: AbortSignal;
	read(jobId: string): Promise<SegmentBytes>;
}): Promise<Buffer> {
	const mux = input.options.mux;
	if (!mux) throw new Error("Native segment mux request is missing");
	const ffmpeg = process.env.ROCUT_NATIVE_FFMPEG_PATH,
		ffprobe = process.env.ROCUT_NATIVE_FFPROBE_PATH;
	if (
		!ffmpeg ||
		!ffprobe ||
		!path.isAbsolute(ffmpeg) ||
		!path.isAbsolute(ffprobe)
	)
		throw new Error(
			"Managed native ffmpeg/ffprobe descriptors are unavailable",
		);
	const toolchain = await Promise.all(
		[ffmpeg, ffprobe].map(async (file) => {
			if (!(await fs.stat(file)).isFile())
				throw new Error("Managed mux executable is not a file");
			return hash(await fs.readFile(file));
		}),
	);
	const temporary = await fs.mkdtemp(
		path.join(os.tmpdir(), "rocut-native-mux-"),
	);
	const cleanup = async () => {
		const actual = await fs.realpath(temporary),
			base = await fs.realpath(os.tmpdir());
		if (
			path.dirname(actual) !== base ||
			!path.basename(actual).startsWith("rocut-native-mux-")
		)
			throw new Error("Native mux work directory changed");
		await fs.rm(actual, { recursive: true, force: true });
	};
	const run = (executable: string, args: string[], maxBytes: number) =>
		runNativeMediaProcess({
			executable,
			args,
			signal: input.signal,
			media: "video",
			maxBytes,
			timeoutMs: 30 * 60 * 1000,
		});
	const fps = `${mux.frameRate.numerator}/${mux.frameRate.denominator}`;
	const grid = (120000 * mux.frameRate.denominator) / mux.frameRate.numerator;
	const withAudio = input.options.includeAudio !== false;
	if (
		input.options.format === "mp4" &&
		(input.options.videoChroma === "444" ||
			(input.options.videoQuantizer ?? 0) > 51)
	)
		throw new Error(
			"Managed OpenH264 mux requires 420 chroma and quantizer at most 51",
		);
	try {
		const inputs: string[] = [],
			filters: string[] = [];
		let geometry: string | undefined;
		for (const [index, segment] of mux.segments.entries()) {
			input.signal.throwIfAborted();
			const { record, bytes } = await input.read(segment.nativeJobId);
			const range = record.request.options.range;
			if (
				record.phase !== "completed" ||
				!record.output ||
				record.output.sha256 !== segment.outputSha256 ||
				hash(bytes) !== segment.outputSha256 ||
				record.output.bytes !== bytes.length ||
				record.request.options.mux ||
				record.request.options.format !== input.options.format ||
				(record.request.options.includeAudio !== false) !== withAudio ||
				range?.startTime !== segment.startFrame * grid ||
				range.endTime !== (segment.startFrame + segment.frameCount) * grid
			)
				throw new Error(
					"Mux segment differs from its completed native source receipt",
				);
			const file = path.join(temporary, `${index}.${input.options.format}`);
			await fs.writeFile(file, bytes, { flag: "wx" });
			const metadata = JSON.parse(
				(
					await run(
						ffprobe,
						[
							"-v",
							"error",
							"-count_frames",
							"-show_entries",
							"stream=codec_type,width,height,avg_frame_rate,nb_read_frames",
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
			if (
				video?.length !== 1 ||
				Number(video[0].nb_read_frames) !== segment.frameCount
			)
				throw new Error(
					"Mux segment decoded frame count differs from its exact interval",
				);
			const [n, d] = String(video[0].avg_frame_rate).split("/").map(Number);
			if (
				!n ||
				!d ||
				n * mux.frameRate.denominator !== d * mux.frameRate.numerator
			)
				throw new Error("Mux segment frame rate differs from the author clock");
			const shape = `${video[0].width}x${video[0].height}`;
			if (geometry && shape !== geometry)
				throw new Error("Mux segments have different geometry");
			geometry = shape;
			if (withAudio) {
				const pcm = await run(
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
						"-f",
						"f32le",
						"pipe:1",
					],
					(segment.sampleCount + 8192) * 8,
				);
				const samples = pcm.length / 8;
				if (
					!Number.isInteger(samples) ||
					samples < segment.sampleCount ||
					samples > segment.sampleCount + 8192
				)
					throw new Error(
						"Mux segment audio cannot cover its exact cumulative sample interval",
					);
				filters.push(
					`[${index}:a:0]aresample=48000,atrim=end_sample=${segment.sampleCount},asetpts=PTS-STARTPTS[a${index}]`,
				);
			}
			inputs.push("-i", file);
			filters.push(
				`[${index}:v:0]trim=end_frame=${segment.frameCount},setpts=N/(${fps}*TB)[v${index}]`,
			);
		}
		const count = mux.segments.reduce(
			(sum, segment) => sum + segment.frameCount,
			0,
		);
		const samples = mux.segments.reduce(
			(sum, segment) => sum + segment.sampleCount,
			0,
		);
		filters.push(
			mux.segments
				.map((_, index) => `[v${index}]${withAudio ? `[a${index}]` : ""}`)
				.join("") +
				`concat=n=${mux.segments.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? "[a]" : ""}`,
		);
		const args = [
			"-v",
			"error",
			"-nostdin",
			...inputs,
			"-filter_complex",
			filters.join(";"),
			"-map",
			"[v]",
			...(withAudio ? ["-map", "[a]", "-ar", "48000"] : ["-an"]),
			"-frames:v",
			String(count),
			"-r",
			fps,
			"-fps_mode",
			"cfr",
			"-pix_fmt",
			input.options.videoChroma === "444" ? "yuv444p" : "yuv420p",
		];
		const final = path.join(temporary, `final.${input.options.format}`);
		args.push(
			...(input.options.format === "mp4"
				? [
						"-c:v",
						"libopenh264",
						"-rc_mode",
						"quality",
						"-qmin",
						String(
							input.options.videoQuantizer ?? quality[input.options.quality],
						),
						"-qmax",
						String(
							input.options.videoQuantizer ?? quality[input.options.quality],
						),
						"-c:a",
						"aac",
						"-movflags",
						"+faststart",
						// The default 1 kHz movie clock rounds AAC edit-list durations.
						// Keep the audible interval exact on the admitted sample grid.
						"-movie_timescale",
						String(mux.sampleRate),
						"-f",
						"mp4",
					]
				: [
						"-c:v",
						"libvpx-vp9",
						"-crf",
						String(
							input.options.videoQuantizer ?? quality[input.options.quality],
						),
						"-b:v",
						"0",
						"-c:a",
						"libopus",
						"-f",
						"webm",
					]),
			"-n",
			final,
		);
		await run(ffmpeg, args, 1024);
		if ((await fs.stat(final)).size > 1024 ** 3)
			throw new Error("Final mux exceeds the native artifact limit");
		const output = await fs.readFile(final);
		await verifyNativeMuxOutput({
			file: final,
			ffprobe,
			ffmpeg,
			run,
			format: input.options.format,
			frames: count,
			samples,
			withAudio,
		});
		const after = await Promise.all(
			[ffmpeg, ffprobe].map(async (file) => hash(await fs.readFile(file))),
		);
		if (after.some((value, index) => value !== toolchain[index]))
			throw new Error("Managed mux toolchain changed during export");
		return output;
	} finally {
		await cleanup();
	}
}
