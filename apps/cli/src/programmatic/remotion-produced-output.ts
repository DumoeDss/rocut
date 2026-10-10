import { createHash, randomUUID } from "node:crypto";
import { writeRemotionArtifactOutputs } from "./remotion-artifact-output";
import type { RemotionArtifactOutput } from "./remotion-artifact-output";
import type { RemotionOwnedArtifact } from "./remotion-artifact-sink";

interface Soundtrack {
	hasAudio: boolean;
	pcm: Uint8Array;
	sampleRate: 44100 | 48000;
	frames: number;
	sampleOrigin: number;
	firstFrame: number;
	frameCount: number;
}

export interface RemotionProducedOutput extends RemotionArtifactOutput {
	audio: {
		path: string;
		byteLength: number;
		sha256: string;
		format: "wav-f32le";
		channels: 2;
		sampleRate: 44100 | 48000;
		frames: number;
		sampleOrigin: number;
		firstFrame: number;
		frameCount: number;
	} | null;
}

/** One owned output transaction for author artifacts and the already mixed
 * native soundtrack. Container validation/packing is supplied by Rust. */
export async function writeRemotionProducedOutputs({
	projectDir,
	artifacts,
	soundtrack,
	signal,
	encodeAudioWav,
}: {
	projectDir: string;
	artifacts: readonly RemotionOwnedArtifact[];
	soundtrack: Soundtrack;
	signal: AbortSignal;
	encodeAudioWav: (packet: Uint8Array) => Uint8Array;
}): Promise<RemotionProducedOutput | undefined> {
	signal.throwIfAborted();
	let audioArtifact: RemotionOwnedArtifact | undefined;
	if (soundtrack.hasAudio) {
		const manifest = Buffer.from(
			JSON.stringify({
				version: 1,
				sampleRate: soundtrack.sampleRate,
				frames: soundtrack.frames,
			}),
			"utf8",
		);
		const header = Buffer.alloc(4);
		header.writeUInt32LE(manifest.length);
		const body = Buffer.from(
			encodeAudioWav(Buffer.concat([header, manifest, soundtrack.pcm])),
		);
		audioArtifact = {
			filename: `__rocut_soundtrack-${randomUUID()}.wav`,
			body,
			sha256: createHash("sha256").update(body).digest("hex"),
			collectionFrame: soundtrack.firstFrame,
			nativeLocalFrame: soundtrack.firstFrame,
			downloadBehavior: null,
		};
	}
	signal.throwIfAborted();
	const output = await writeRemotionArtifactOutputs({
		projectDir,
		signal,
		artifacts: audioArtifact ? [...artifacts, audioArtifact] : artifacts,
	});
	if (!output) return undefined;
	const storedAudio = audioArtifact ? output.artifacts.at(-1)! : undefined;
	return {
		directory: output.directory,
		artifacts: storedAudio ? output.artifacts.slice(0, -1) : output.artifacts,
		audio: storedAudio
			? {
					path: storedAudio.path,
					byteLength: storedAudio.byteLength,
					sha256: storedAudio.sha256,
					format: "wav-f32le",
					channels: 2,
					sampleRate: soundtrack.sampleRate,
					frames: soundtrack.frames,
					sampleOrigin: soundtrack.sampleOrigin,
					firstFrame: soundtrack.firstFrame,
					frameCount: soundtrack.frameCount,
				}
			: null,
	};
}
