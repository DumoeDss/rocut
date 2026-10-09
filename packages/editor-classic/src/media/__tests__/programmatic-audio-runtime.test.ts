import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type {
	ProgrammaticAudioData,
	ProgrammaticFrameProvider,
} from "@opencut/editor-ports/host";
import { ProgrammaticAudioRuntime } from "../programmatic-audio-runtime";

function source(): ProgrammaticSource {
	const sha256 = "a".repeat(64);
	const input = {
		id: "index.tsx",
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
		audio: { version: 1, mode: "native" },
		build: {
			version: 1,
			engine: "remotion",
			engineVersion: "4.0.440",
			compositionId: "Audio",
			entryFile: "index.tsx",
			inputs: [input],
			toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
		},
	};
}

function pcm(sampleRate = 44100): ProgrammaticAudioData {
	const frames = sampleRate / 10;
	return {
		pcm: new Float32Array(frames * 2).fill(0.125).buffer,
		sampleRate,
		channels: 2,
		frames,
		sampleOrigin: 0,
		hasAudio: true,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function harness() {
	const calls: Array<{
		signal: AbortSignal;
		request: unknown;
		work: ReturnType<typeof deferred<ProgrammaticAudioData>>;
	}> = [];
	const provider: ProgrammaticFrameProvider = {
		async renderPng() {
			throw Error("Unexpected picture request");
		},
		renderAudio({ request, signal }) {
			const work = deferred<ProgrammaticAudioData>();
			calls.push({ signal, request, work });
			return work.promise;
		},
	};
	return { runtime: new ProgrammaticAudioRuntime(provider), calls };
}
const signal = () => new AbortController().signal;

test("cached PCM cannot escape an intervening project invalidation", async () => {
	const { runtime, calls } = harness();
	const first = runtime.load({ source: source(), signal: signal() });
	await Promise.resolve();
	calls[0].work.resolve(pcm());
	await first;
	const stale = runtime.load({ source: source(), signal: signal() });
	const rejection = stale.catch((error) => error);
	await runtime.invalidate();
	expect(await rejection).toMatchObject({ name: "AbortError" });
});

test("malformed persisted audio is rejected instead of silently omitted", async () => {
	const { runtime, calls } = harness();
	for (const audio of [
		null,
		false,
		0,
		{ version: 1, mode: "native", volumeDb: 21 },
	]) {
		await expect(
			runtime.load({
				// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- corrupt persisted payload must reach the real Rust admission boundary.
				source: { ...source(), audio } as ProgrammaticSource,
				signal: signal(),
			}),
		).rejects.toThrow();
	}
	expect(calls).toHaveLength(0);
});

test("concurrent consumers share PCM but keep independent gain and cancellation", async () => {
	const { runtime, calls } = harness(),
		controller = new AbortController();
	const first = runtime.load({ source: source(), signal: controller.signal });
	const second = runtime.load({
		source: {
			...source(),
			audio: { version: 1, mode: "native", volumeDb: -6 },
		},
		signal: signal(),
	});
	await Promise.resolve();
	expect(calls).toHaveLength(1);
	const rejection = first.catch((error) => error);
	controller.abort();
	expect(await rejection).toMatchObject({ name: "AbortError" });
	expect(calls[0].signal.aborted).toBe(false);
	const data = pcm();
	calls[0].work.resolve(data);
	expect(await second).toEqual({ data, gain: 0.5011872336272722 });
	expect(
		(await runtime.load({ source: source(), signal: signal() }))?.data,
	).toBe(data);
	expect(
		await runtime.load({
			source: {
				...source(),
				audio: { version: 1, mode: "native", muted: true },
			},
			signal: signal(),
		}),
	).toBeNull();
	expect(calls).toHaveLength(1);
	await runtime.invalidate();
});

test("last consumer cancellation aborts IO, drain waits, and cancelled PCM is never reused", async () => {
	const { runtime, calls } = harness(),
		controller = new AbortController();
	const first = runtime.load({ source: source(), signal: controller.signal });
	await Promise.resolve();
	const rejection = first.catch((error) => error);
	controller.abort();
	expect(await rejection).toMatchObject({ name: "AbortError" });
	expect(calls[0].signal.aborted).toBe(true);
	let drained = false;
	const drain = runtime.invalidate().then(() => {
		drained = true;
	});
	await Promise.resolve();
	expect(drained).toBe(false);
	calls[0].work.resolve(pcm());
	await drain;
	expect(drained).toBe(true);
	const next = runtime.load({ source: source(), signal: signal() });
	await Promise.resolve();
	expect(calls).toHaveLength(2);
	calls[1].work.resolve(pcm());
	await next;
	await runtime.invalidate();
});

test("source and sample rate changes get new PCM and requests snapshot mutable inputs", async () => {
	const { runtime, calls } = harness(),
		original = source();
	const first = runtime.load({ source: original, signal: signal() });
	(original.frameRate as { numerator: number }).numerator = 60;
	await Promise.resolve();
	expect(calls[0].request).toMatchObject({
		source: { frameRate: { numerator: 30 } },
	});
	calls[0].work.resolve(pcm());
	await first;
	const second = runtime.load({
		source: { ...source(), seed: 2 },
		signal: signal(),
	});
	await Promise.resolve();
	calls[1].work.resolve(pcm());
	await second;
	const third = runtime.load({
		source: source(),
		sampleRate: 48000,
		signal: signal(),
	});
	await Promise.resolve();
	calls[2].work.resolve(pcm(48000));
	await third;
	expect(calls).toHaveLength(3);
	await runtime.invalidate();
});

test("invalid/nonfinite provider data fails and the next attempt retries", async () => {
	const invalid = [
		{ ...pcm(), sampleOrigin: 1 },
		{ ...pcm(), frames: 1 },
		{ ...pcm(), channels: 1 },
		{ ...pcm(), sampleRate: 48000 },
		{ ...pcm(), pcm: new ArrayBuffer(8) },
		{ ...pcm(), hasAudio: 1 },
		{ ...pcm(), pcm: new Float32Array(8820).fill(NaN).buffer },
	];
	for (const bad of invalid) {
		const { runtime, calls } = harness();
		const first = runtime.load({ source: source(), signal: signal() });
		const rejection = first.catch((error) => error);
		await Promise.resolve();
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- deliberately malformed host response, not an implementation cast.
		calls[0].work.resolve(bad as ProgrammaticAudioData);
		expect(await rejection).toBeInstanceOf(Error);
		const next = runtime.load({ source: source(), signal: signal() });
		await Promise.resolve();
		calls[1].work.resolve(pcm());
		expect(await next).not.toBeNull();
		await runtime.invalidate();
	}
});

test("provider failure retries; successful silence is cached; undeclared source requires no provider", async () => {
	const { runtime, calls } = harness();
	const first = runtime.load({ source: source(), signal: signal() });
	const rejection = first.catch((error) => error);
	await Promise.resolve();
	calls[0].work.reject(Error("decoder failed"));
	expect((await rejection).message).toBe("decoder failed");
	const second = runtime.load({ source: source(), signal: signal() });
	await Promise.resolve();
	calls[1].work.resolve({ ...pcm(), hasAudio: false });
	expect(await second).toBeNull();
	expect(await runtime.load({ source: source(), signal: signal() })).toBeNull();
	expect(calls).toHaveLength(2);
	expect(
		await new ProgrammaticAudioRuntime().load({
			source: { ...source(), audio: undefined },
			signal: signal(),
		}),
	).toBeNull();
	await expect(
		new ProgrammaticAudioRuntime().load({ source: source(), signal: signal() }),
	).rejects.toThrow("cannot render");
	await runtime.invalidate();
});
