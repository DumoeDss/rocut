import * as wasm from "opencut-wasm";
import type { MediaFacts } from "@opencut/editor-contracts";
import type { InputVideoTrack } from "mediabunny";

// Versioned optional ABI: older installed WASM must not manufacture facts.
function optionalNativeStringExport(name: string) {
	const implementation: unknown = Reflect.get(wasm, name);
	if (typeof implementation !== "function") return undefined;
	return (input: Uint8Array | string): string => {
		const result: unknown = implementation(input);
		if (typeof result !== "string")
			throw new Error(`Native media facts export ${name} returned no JSON`);
		return result;
	};
}
const native = {
	inspectMediaFactsBytes: optionalNativeStringExport("inspectMediaFactsBytes"),
	validateMediaFactsJson: optionalNativeStringExport("validateMediaFactsJson"),
};
export const supportsMediaFacts = () =>
	typeof native.inspectMediaFactsBytes === "function" &&
	typeof native.validateMediaFactsJson === "function";

export function decodeMediaFacts(value: unknown): MediaFacts | undefined {
	if (!native.validateMediaFactsJson) return undefined;
	try {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) return undefined;
		const validated: MediaFacts | null = JSON.parse(
			native.validateMediaFactsJson(serialized),
		);
		return validated ?? undefined;
	} catch {
		// Optional legacy metadata or an unavailable ABI is not evidence.
		return undefined;
	}
}

/** Independent source-byte digest. Never copy mediaFacts.sha256 into this pin. */
export async function sourceBytesSha256(bytes: Uint8Array): Promise<string> {
	const hash = await globalThis.crypto.subtle.digest(
		"SHA-256",
		bytes.slice().buffer,
	);
	return Array.from(new Uint8Array(hash), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

async function observeVideoPackets(video: InputVideoTrack) {
	try {
		const { EncodedPacketSink } = await import("mediabunny");
		const timebase = await video.getTimeResolution();
		const sink = new EncodedPacketSink(video);
		const options = { metadataOnly: true };
		let packet = await sink.getFirstPacket(options);
		const timestampsSeconds: number[] = [];
		const durationsSeconds: number[] = [];
		while (packet && timestampsSeconds.length < 256) {
			timestampsSeconds.push(packet.timestamp);
			durationsSeconds.push(packet.duration);
			packet = await sink.getNextPacket(packet, options);
		}
		return {
			timebase,
			timestampsSeconds,
			durationsSeconds,
			complete: packet === null,
		};
	} catch {
		// Missing/unsupported demux timing API cannot become an exact-rate claim.
		return undefined;
	}
}

/** Demux and byte transport only; Rust owns interpretation and fact schema. */
export async function probeSourceMediaFacts({
	bytes,
	mimeType = "",
}: {
	bytes: Uint8Array;
	mimeType?: string;
}): Promise<MediaFacts | undefined> {
	if (!supportsMediaFacts()) return undefined;
	const observations: Record<string, unknown> = { mimeType };
	if (!mimeType.startsWith("image/")) {
		const { Input, BufferSource, ALL_FORMATS } = await import("mediabunny");
		const input = new Input({
			source: new BufferSource(bytes),
			formats: ALL_FORMATS,
		});
		try {
			const video = await input.getPrimaryVideoTrack();
			const audio = await input.getPrimaryAudioTrack();
			if (video) {
				const stats = await video.computePacketStats(100);
				observations.packetCount = stats.packetCount;
				observations.averagePacketRate = stats.averagePacketRate;
				const videoPackets = await observeVideoPackets(video);
				if (videoPackets) observations.videoPackets = videoPackets;
			}
			if (audio)
				observations.audio = {
					channels: audio.numberOfChannels,
					sampleRate: audio.sampleRate,
				};
		} catch {
			// Unsupported container means no corresponding observations, not false.
		} finally {
			input.dispose();
		}
	}
	const header = new TextEncoder().encode(JSON.stringify(observations));
	const envelope = new Uint8Array(4 + header.length + bytes.length);
	new DataView(envelope.buffer).setUint32(0, header.length, true);
	envelope.set(header, 4);
	envelope.set(bytes, 4 + header.length);
	return decodeMediaFacts(JSON.parse(native.inspectMediaFactsBytes!(envelope)));
}
