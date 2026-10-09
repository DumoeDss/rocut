import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type {
	ProgrammaticAudioData,
	ProgrammaticAudioIdentity,
	ProgrammaticFrameProvider,
} from "@opencut/editor-ports/host";
import { ProgrammaticAudioRuntime } from "../programmatic-audio-runtime";

export function graphSource(): ProgrammaticSource {
	const sha256 = "a".repeat(64);
	const input = {
		id: "index.html",
		kind: "source" as const,
		mimeType: "application/octet-stream" as const,
		byteLength: 1,
		sha256,
		attachmentKey: `programmatic-source-sha256-${sha256}`,
	};
	return {
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "build.html",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 3,
		seed: 1,
		resources: [
			{
				id: "build.html",
				kind: "document",
				mimeType: "text/html",
				byteLength: 1,
				sha256,
				attachmentKey: `programmatic-sha256-${sha256}`,
			},
		],
		audio: { version: 1, mode: "native", profile: "hyperframes-graph-v1" },
		build: {
			version: 1,
			engine: "hyperframes",
			engineVersion: "0.8.139",
			entryFile: "index.html",
			inputs: [input],
			toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
		},
	};
}

export function identity(hex = "a"): ProgrammaticAudioIdentity {
	return { version: 1, profile: "hyperframes-graph-v1", id: hex.repeat(64) };
}

export function pcm(
	runtimeIdentity?: ProgrammaticAudioIdentity,
): ProgrammaticAudioData {
	return {
		pcm: new Float32Array(8820).fill(0.125).buffer,
		sampleRate: 44100,
		channels: 2,
		frames: 4410,
		sampleOrigin: 0,
		hasAudio: true,
		...(runtimeIdentity ? { identity: runtimeIdentity } : {}),
	};
}

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

interface Call {
	request: unknown;
	signal: AbortSignal;
}

export function harness() {
	const identities: Call[] = [];
	const renders: Call[] = [];
	const hooks: {
		identify: (call: Call) => Promise<ProgrammaticAudioIdentity>;
		render: (call: Call) => Promise<ProgrammaticAudioData>;
	} = {
		identify: async () => identity(),
		render: async () => pcm(identity()),
	};
	const provider: ProgrammaticFrameProvider = {
		async renderPng() {
			throw Error("Unexpected picture request");
		},
		getAudioIdentity(call) {
			identities.push(call);
			return hooks.identify(call);
		},
		renderAudio(call) {
			renders.push(call);
			return hooks.render(call);
		},
	};
	return {
		runtime: new ProgrammaticAudioRuntime(provider),
		provider,
		hooks,
		identities,
		renders,
	};
}

export const signal = () => new AbortController().signal;
