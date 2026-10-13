import { lstat } from "node:fs/promises";
import { dirname, extname, isAbsolute } from "node:path";
import {
	decodeNativeVideoFrame,
	type NativeVideoDecoder,
} from "./programmatic/video-decoder";
import {
	posterDigest,
	posterDirectory,
	posterPaths,
	posterPng,
	POSTER_PNG_LIMIT,
	POSTER_SOURCE_LIMIT,
	readPosterFile,
	writePosterFile,
} from "./video-poster-files";

export interface VideoPosterInput {
	projectRoot: string;
	sourceRelativePath: string;
	sourceSha256: string;
	destinationRelativePath: string;
}
export async function videoPosterCapability(decoder?: NativeVideoDecoder) {
	if (!decoder)
		return {
			status: "unavailable" as const,
			reason: "Native video decoder is not configured",
		};
	for (const file of [decoder.ffmpeg, decoder.ffprobe]) {
		if (!isAbsolute(file))
			return {
				status: "unavailable" as const,
				reason: "Native video decoder paths must be host-configured",
			};
		try {
			const stat = await lstat(file);
			if (!stat.isFile() || stat.isSymbolicLink()) throw Error();
		} catch {
			return {
				status: "unavailable" as const,
				reason: "Configured native video decoder is unavailable",
			};
		}
	}
	return {
		status: "available" as const,
		capability: "offline-video-poster-v1" as const,
	};
}
/** Offline native IO only: no editor, surface, timeline, compiler or network. */
export async function createVideoPoster(
	input: VideoPosterInput,
	options: {
		decoder?: NativeVideoDecoder;
		signal?: AbortSignal;
		timeoutMs?: number;
	} = {},
) {
	if (
		!input ||
		typeof input !== "object" ||
		Object.keys(input).sort().join(",") !==
			"destinationRelativePath,projectRoot,sourceRelativePath,sourceSha256"
	)
		throw Error("Invalid fixed poster request");
	const decoder = options.decoder;
	const capability = await videoPosterCapability(decoder);
	if (capability.status === "unavailable") return capability;
	if (!decoder) throw Error("Poster decoder invariant failed");
	const timeoutMs = options.timeoutMs ?? 30000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
		throw Error("Invalid poster timeout");
	const controller = new AbortController(),
		timer = setTimeout(
			() => controller.abort(Error("Poster timed out")),
			timeoutMs,
		);
	const abort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener("abort", abort, { once: true });
	if (options.signal?.aborted) abort();
	const signal = controller.signal;
	try {
		signal.throwIfAborted();
		const paths = await posterPaths(input);
		const extension = extname(paths.source).toLowerCase();
		if (extension !== ".mp4" && extension !== ".webm")
			throw Error("Poster source container is not admitted");
		const body = await readPosterFile(
			paths.source,
			POSTER_SOURCE_LIMIT,
			signal,
		);
		if (!body || posterDigest(body) !== input.sourceSha256)
			throw Error("Poster source SHA256 differs from fixed pin");
		const outputDirectory = await posterDirectory(
			dirname(paths.destination),
			true,
		);
		const proofFile = paths.destination + ".proof.json";
		const cached = await readPosterFile(
			paths.destination,
			POSTER_PNG_LIMIT,
			signal,
			true,
		);
		const proof = await readPosterFile(proofFile, 4096, signal, true);
		if (cached && proof) {
			const expected = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(proof),
			);
			const measured = posterPng(cached);
			if (
				expected.format !== "rocut-video-poster/1" ||
				expected.sourceSha256 !== input.sourceSha256 ||
				expected.sourceTime !== 0 ||
				Object.entries(measured).some(([key, value]) => expected[key] !== value)
			)
				throw Error("Cached poster proof differs from fixed output");
			return {
				status: "completed" as const,
				relativePath: paths.destinationRelativePath,
				...measured,
				mimeType: "image/png" as const,
				sourceSha256: input.sourceSha256,
				sourceTime: 0,
			};
		}
		if (proof && !cached)
			throw Error("Poster proof has no corresponding output");
		const frame = await decodeNativeVideoFrame({
			decoder,
			body,
			mimeType: extension === ".mp4" ? "video/mp4" : "video/webm",
			seconds: 0,
			transparent: false,
			signal,
			limits: { maxBytes: POSTER_SOURCE_LIMIT, maxDimension: 4096 },
			selection: "first",
			thumbnail: { maxDimension: 512, maxBytes: POSTER_PNG_LIMIT },
		});
		signal.throwIfAborted();
		const measured = posterPng(frame.png);
		if (frame.index !== 0 || frame.sourceTime !== 0)
			throw Error("Poster decoder did not return frame zero");
		// Revalidate source and directories after native work, before committing.
		const currentSource = await readPosterFile(
			paths.source,
			POSTER_SOURCE_LIMIT,
			signal,
		);
		if (!currentSource || posterDigest(currentSource) !== input.sourceSha256)
			throw Error("Poster source changed during decode");
		await posterPaths(input);
		await posterDirectory(outputDirectory);
		await writePosterFile(paths.destination, frame.png, signal);
		await writePosterFile(
			proofFile,
			Buffer.from(
				JSON.stringify({
					format: "rocut-video-poster/1",
					sourceSha256: input.sourceSha256,
					sourceTime: 0,
					...measured,
				}),
			),
			signal,
		);
		return {
			status: "completed" as const,
			relativePath: paths.destinationRelativePath,
			...measured,
			mimeType: "image/png" as const,
			sourceSha256: input.sourceSha256,
			sourceTime: 0,
		};
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", abort);
	}
}
