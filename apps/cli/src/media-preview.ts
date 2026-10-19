import { join } from "node:path";
import {
	posterDirectory,
	posterDigest,
	posterPng,
	readPosterFile,
} from "./video-poster-files";
import { videoPosterCapability } from "./video-poster";
import { createNativeFrameSlots } from "./programmatic/frame-job-slots";
import {
	decodeNativeVideoFrame,
	type NativeVideoDecoder,
} from "./programmatic/video-decoder";

const SOURCE_LIMIT = 64 * 1024 * 1024;
const OUTPUT_LIMIT = 1024 * 1024;

export class MediaPreviewError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function parsePreview(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new MediaPreviewError(400, "Invalid media preview request");
	const data = value as Record<string, unknown>;
	if (
		Object.keys(data).sort().join(",") !== "mediaId,sourceSha256,timeSeconds" ||
		typeof data.mediaId !== "string" ||
		!/^[A-Za-z0-9._-]{1,160}$/.test(data.mediaId) ||
		data.mediaId === "." ||
		data.mediaId === ".." ||
		typeof data.sourceSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(data.sourceSha256) ||
		typeof data.timeSeconds !== "number" ||
		!Number.isFinite(data.timeSeconds) ||
		data.timeSeconds < 0 ||
		data.timeSeconds > 24 * 60 * 60
	)
		throw new MediaPreviewError(
			400,
			"Invalid media preview identity or source time",
		);
	return {
		mediaId: data.mediaId,
		sourceSha256: data.sourceSha256,
		timeSeconds: data.timeSeconds,
	};
}

/** Native IO adapter; project/history/import records are never written here. */
export function createMediaPreviewService({
	projectRoot,
	decoder = process.env.ROCUT_NATIVE_FFMPEG_PATH &&
	process.env.ROCUT_NATIVE_FFPROBE_PATH
		? {
				ffmpeg: process.env.ROCUT_NATIVE_FFMPEG_PATH,
				ffprobe: process.env.ROCUT_NATIVE_FFPROBE_PATH,
			}
		: undefined,
	decodeFrame = decodeNativeVideoFrame,
}: {
	projectRoot: string;
	decoder?: NativeVideoDecoder;
	decodeFrame?: typeof decodeNativeVideoFrame;
}) {
	const slots = createNativeFrameSlots();
	const active = new Map<AbortController, Promise<unknown>>();
	let disposed = false;
	return {
		async capability() {
			const result = await videoPosterCapability(decoder);
			return {
				version: 1,
				route: "media/preview",
				available: !disposed && result.status === "available",
				maxSourceBytes: SOURCE_LIMIT,
				maxOutputBytes: OUTPUT_LIMIT,
				maxDimension: 512,
				profile: "native-attachment-thumbnail-v1",
			};
		},
		async render({
			input,
			signal,
		}: {
			input: unknown;
			signal: AbortSignal;
		}): Promise<Buffer> {
			const spec = parsePreview(input);
			if (disposed)
				throw new MediaPreviewError(503, "Media preview service is closed");
			if (
				!decoder ||
				(await videoPosterCapability(decoder)).status !== "available"
			)
				throw new MediaPreviewError(
					501,
					"Native media previews are unavailable",
				);
			// Capability probing yields; shutdown may have closed admission meanwhile.
			if (disposed)
				throw new MediaPreviewError(503, "Media preview service is closed");
			const controller = new AbortController();
			const abort = () => controller.abort(signal.reason);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			const timer = setTimeout(
				() => controller.abort(Error("Native preview timed out")),
				15000,
			);
			const work = (async () => {
				const release = await slots.acquire(controller.signal);
				if (!release)
					throw new MediaPreviewError(
						429,
						"Native media preview decoder is busy",
					);
				try {
					const directory = await posterDirectory(
						join(projectRoot, "attachments", spec.mediaId),
					);
					const metadataBytes = await readPosterFile(
						join(directory, "metadata.json"),
						64 * 1024,
						controller.signal,
					);
					const metadata: unknown = JSON.parse(
						new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes),
					);
					if (
						!metadata ||
						typeof metadata !== "object" ||
						!("id" in metadata) ||
						metadata.id !== spec.mediaId ||
						!("type" in metadata) ||
						metadata.type !== "video" ||
						!("mimeType" in metadata) ||
						(metadata.mimeType !== "video/mp4" &&
							metadata.mimeType !== "video/webm")
					)
						throw new MediaPreviewError(
							400,
							"Preview source is not an imported video attachment",
						);
					const body = await readPosterFile(
						join(directory, "body.bin"),
						SOURCE_LIMIT,
						controller.signal,
					);
					if (!body || posterDigest(body) !== spec.sourceSha256)
						throw new MediaPreviewError(
							409,
							"Preview source SHA256 differs from fixed content",
						);
					const frame = await decodeFrame({
						decoder,
						body,
						mimeType: metadata.mimeType,
						seconds: spec.timeSeconds,
						transparent: false,
						signal: controller.signal,
						limits: { maxBytes: SOURCE_LIMIT, maxDimension: 4096 },
						selection: spec.timeSeconds === 0 ? "first" : "containing",
						thumbnail: { maxDimension: 512, maxBytes: OUTPUT_LIMIT },
					});
					controller.signal.throwIfAborted();
					posterPng(frame.png);
					return frame.png;
				} finally {
					release();
				}
			})();
			active.set(controller, work);
			try {
				return await work;
			} finally {
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				active.delete(controller);
			}
		},
		async dispose() {
			disposed = true;
			for (const controller of active.keys())
				controller.abort(Error("Media preview service closed"));
			await Promise.allSettled(active.values());
		},
	};
}
