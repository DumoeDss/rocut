import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { runVideoDecoderProcess } from "./video-decoder-process";
import { nativeVideoColorFilters, nativeVideoPngFilters, type NativeVideoColorMetadata } from "./video-color";

/** Host-owned paths; never accept these from authored JS or an Agent request. */
export interface NativeVideoDecoder {
	readonly ffmpeg: string;
	readonly ffprobe: string;
}

interface StreamMetadata extends NativeVideoColorMetadata {
	codec_name?: string;
	width?: number;
	height?: number;
	start_time?: string;
	tags?: { alpha_mode?: string };
}

/** Decoder IO primitive for the Offthread bridge, not an exposed API.
 * Timing is supplied by native Remotion; byte/dimension limits by resolved Rust.
 * No Html5Video fallback, remote URL, arbitrary input path or independent export.
 */
export async function decodeNativeVideoFrame({ decoder, body, mimeType, seconds, transparent, signal, limits, selection = "containing", toneMapped = true, thumbnail }: {
	decoder: NativeVideoDecoder;
	body: Uint8Array;
	mimeType: "video/mp4" | "video/webm";
	seconds: number;
	transparent: boolean;
	toneMapped?: boolean;
	signal: AbortSignal;
	limits: { maxBytes: number; maxDimension: number };
	selection?: "containing" | "nearest" | "first";
	/** Host-only bounded poster output; absent preserves native compositor pixels. */
	thumbnail?: { maxDimension: number; maxBytes: number };
}): Promise<{ png: Buffer; index: number; sourceTime: number; width: number; height: number }> {
	signal.throwIfAborted();
	if (!isAbsolute(decoder.ffmpeg) || !isAbsolute(decoder.ffprobe)) throw Error("Native video decoder paths must be host-configured absolute paths");
	if (!Number.isFinite(seconds) || seconds < 0) throw Error("Native video time must be finite and nonnegative");
	if (!Number.isSafeInteger(Math.round(seconds * 1e6))) throw Error("Native video time is not representable");
	if (!["containing", "nearest", "first"].includes(selection)) throw Error("Invalid native video selection");
	if (thumbnail && (!Number.isSafeInteger(thumbnail.maxDimension) || thumbnail.maxDimension < 1 || !Number.isSafeInteger(thumbnail.maxBytes) || thumbnail.maxBytes < 1)) throw Error("Invalid native thumbnail limits");
	if (typeof toneMapped !== "boolean") throw Error("Invalid native video tone-mapping option");
	if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || !Number.isSafeInteger(limits.maxDimension) || limits.maxDimension < 1)
		throw Error("Missing Rust video decode limits");
	if (!body.byteLength || body.byteLength > limits.maxBytes) throw Error("Native video exceeds the Rust resource byte limit");
	if (mimeType !== "video/mp4" && mimeType !== "video/webm") throw Error("Native video container is not admitted");
	const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-native-decode-"));
	try {
		const input = join(root, mimeType === "video/mp4" ? "source.mp4" : "source.webm");
		await writeFile(input, body, { flag: "wx" });
		// Force the admitted demuxer: a disguised playlist must never become an IO
		// program. MOV external data references remain disabled, including file URLs.
		const inputArgs = ["-protocol_whitelist", "file,pipe", "-f", mimeType === "video/mp4" ? "mov" : "matroska",
			...(mimeType === "video/mp4" ? ["-enable_drefs", "0"] : [])];
		const probe = async (args: string[], maxBytes: number) => JSON.parse((await runVideoDecoderProcess({
			executable: decoder.ffprobe, args: ["-v", "error", "-threads", "1", ...inputArgs, ...args, "-of", "json", input], signal, maxBytes,
		})).toString("utf8"));
		const metadata = await probe(["-select_streams", "v:0", "-show_streams"], 65536);
		const stream = metadata.streams?.[0] as StreamMetadata | undefined;
		const width = stream?.width, height = stream?.height;
		if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width! < 1 || height! < 1
			|| width! > limits.maxDimension || height! > limits.maxDimension) throw Error("Native video metadata exceeds the Rust decode limits");
		const colorFilters = nativeVideoColorFilters(stream!, toneMapped);
		// Frame zero needs no whole-file frame index. The decoder still proves a
		// real first frame through its bounded PNG output (including B-frame input).
		const timing = selection === "first" ? { frames: [{ best_effort_timestamp_time: stream?.start_time ?? "0" }] }
			: await probe(["-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time"], 8_000_000);
		if (!Array.isArray(timing.frames) || !timing.frames.length) throw Error("Native video has no decoded frames");
		// Generic extraction contains the timestamp. Native Remotion Offthread
		// instead selects the nearest decoded PTS, ties going to the later frame
		// (pinned compositor frame_cache.rs). Never substitute nominal frame rate.
		const target = Math.round(seconds * 1e6);
		const streamStart = Number(stream?.start_time);
		const origin = Math.round((Number.isFinite(streamStart) ? streamStart : Number(timing.frames[0].best_effort_timestamp_time)) * 1e6);
		if (!Number.isSafeInteger(origin)) throw Error("Native video origin timestamp is not representable");
		let index = 0, sourceTime = 0, previous = -Infinity, distance = Infinity;
		for (const [ordinal, frame] of timing.frames.entries()) {
			// Media seconds are relative to the stream start, not container PTS.
			// Integer microseconds also prevent 2.01 - 2 becoming less than .01.
			const timestamp = Math.round(Number(frame.best_effort_timestamp_time) * 1e6) - origin;
			if (!Number.isSafeInteger(timestamp) || timestamp < previous) throw Error("Native video frame timestamps are not ordered");
			previous = timestamp;
			if (ordinal === 0 || (selection === "nearest" ? Math.abs(timestamp - target) <= distance : timestamp <= target)) {
				index = ordinal; sourceTime = timestamp / 1e6; distance = Math.abs(timestamp - target);
			}
		}
		const alphaDecoder = transparent && stream?.codec_name === "vp9" && stream.tags?.alpha_mode === "1" ? ["-c:v", "libvpx-vp9"] : [];
		const select = `select=eq(n\\,${index})`;
		// Poster PNGs use square pixels and preserve the displayed aspect ratio,
		// including anamorphic SAR and the decoder's automatic display rotation.
		const shrink = thumbnail ? `min(1,min(${thumbnail.maxDimension}/(iw*sar),${thumbnail.maxDimension}/ih))` : "";
		const pngFilters = [...(thumbnail ? [`scale=w='max(1,trunc(iw*sar*${shrink}))':h='max(1,trunc(ih*${shrink}))'`, "setsar=1"] : []), ...nativeVideoPngFilters(transparent)];
		const filterArgs = colorFilters.length && transparent
			? ["-filter_complex", `[0:v:0]${select},split[nativeColor][nativeAlpha];` +
				"[nativeAlpha]format=rgba,alphaextract[nativeMask];" +
				`[nativeColor]${colorFilters.join(",")},format=rgb24[nativeRgb];` +
				`[nativeRgb][nativeMask]alphamerge,format=rgba,${pngFilters.join(",")}[nativeFrame]`, "-map", "[nativeFrame]"]
			: ["-map", "0:v:0", "-vf", [select, ...colorFilters, transparent ? "format=rgba" : "format=rgb24", ...pngFilters].join(",")];
		const png = await runVideoDecoderProcess({
			executable: decoder.ffmpeg, signal, maxBytes: thumbnail?.maxBytes ?? width! * height! * 5 + 65536,
			args: ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", ...inputArgs, ...alphaDecoder,
				"-i", input, ...filterArgs, "-an", "-sn", "-dn",
				"-fps_mode", "passthrough", "-frames:v", "1", "-threads", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"],
		});
		if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.length < 24)
			throw Error("Native decoder returned an invalid frame");
		// FFmpeg applies the stream's display matrix before PNG output, including
		// portrait rotation. Use actual output geometry, never stretch to raw dimensions.
		const outputWidth = png.readUInt32BE(16), outputHeight = png.readUInt32BE(20);
		if (outputWidth < 1 || outputHeight < 1 || outputWidth > limits.maxDimension || outputHeight > limits.maxDimension)
			throw Error("Native decoded frame exceeds the Rust decode limits");
		if (thumbnail && (outputWidth > thumbnail.maxDimension || outputHeight > thumbnail.maxDimension)) throw Error("Native decoded thumbnail exceeds output limits");
		return { png, index, sourceTime, width: outputWidth, height: outputHeight };
	} finally {
		if (dirname(root) !== parent || !basename(root).startsWith("rocut-native-decode-")) throw Error("Unsafe native decoder cleanup");
		await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}
