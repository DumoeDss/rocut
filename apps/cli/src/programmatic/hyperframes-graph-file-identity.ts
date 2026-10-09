import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { isAbsolute } from "node:path";
import type { NativeVideoDecoder } from "./video-decoder";

export interface HyperframesGraphFileIdentity {
	readonly sha256: string;
	readonly byteLength: number;
}
export interface HyperframesGraphDecoderIdentity {
	readonly ffmpeg: HyperframesGraphFileIdentity;
	readonly ffprobe: HyperframesGraphFileIdentity;
}
const sameFile = (a: BigIntStats, b: BigIntStats) =>
	a.dev === b.dev &&
	a.ino === b.ino &&
	a.size === b.size &&
	a.mtimeNs === b.mtimeNs &&
	a.ctimeNs === b.ctimeNs;

/** Stream actual bytes, not paths or stat metadata, into the identity. Metadata
 * checks only reject a moving file during the read, including pathname swaps.
 * This is a trusted-installation cache discriminator, not executable attestation. */
export async function hyperframesGraphFileIdentity(
	path: string,
	signal: AbortSignal,
): Promise<HyperframesGraphFileIdentity> {
	signal.throwIfAborted();
	if (!isAbsolute(path))
		throw Error(
			"Graph decoder identity requires configured absolute executable paths",
		);
	try {
		const file = await open(path, "r");
		try {
			const before = await file.stat({ bigint: true });
			if (
				!before.isFile() ||
				before.size <= 0n ||
				before.size > 512n * 1024n * 1024n
			)
				throw Error("Invalid graph decoder executable size");
			const byteLength = Number(before.size),
				chunk = Buffer.alloc(Math.min(byteLength, 256 * 1024));
			const hash = createHash("sha256");
			let offset = 0;
			while (offset < byteLength) {
				signal.throwIfAborted();
				const { bytesRead } = await file.read(
					chunk,
					0,
					Math.min(chunk.length, byteLength - offset),
					offset,
				);
				if (!bytesRead)
					throw Error("Graph decoder executable changed while hashing");
				hash.update(chunk.subarray(0, bytesRead));
				offset += bytesRead;
			}
			const after = await file.stat({ bigint: true }),
				current = await stat(path, { bigint: true });
			if (!sameFile(before, after) || !sameFile(after, current))
				throw Error("Graph decoder executable changed while hashing");
			signal.throwIfAborted();
			return Object.freeze({ sha256: hash.digest("hex"), byteLength });
		} finally {
			await file.close();
		}
	} catch (error) {
		signal.throwIfAborted();
		// Do not return OS errors containing configured local paths to clients.
		if (
			error instanceof Error &&
			/^Invalid graph decoder executable size$|^Graph decoder executable changed while hashing$/.test(
				error.message,
			)
		)
			throw error;
		throw Error("Cannot read configured graph decoder executable identity");
	}
}

export async function hyperframesGraphDecoderIdentity(
	decoder: NativeVideoDecoder,
	signal: AbortSignal,
): Promise<HyperframesGraphDecoderIdentity> {
	const ffmpeg = await hyperframesGraphFileIdentity(decoder.ffmpeg, signal);
	const ffprobe = await hyperframesGraphFileIdentity(decoder.ffprobe, signal);
	return Object.freeze({ ffmpeg, ffprobe });
}
