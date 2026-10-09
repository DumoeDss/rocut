import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type {
	ProgrammaticAudioData,
	ProgrammaticAudioIdentity,
} from "@opencut/editor-ports/host";
import { ProgrammaticAudioRuntime } from "../programmatic-audio-runtime";
import {
	deferred,
	graphSource,
	harness,
	identity,
	pcm,
	signal,
} from "./programmatic-audio-graph-fixture";

test("graph profile survives render/cache normalization while gain and mute stay outside PCM", async () => {
	const { runtime, identities, renders } = harness();
	const source: ProgrammaticSource = {
		...graphSource(),
		audio: {
			version: 1,
			mode: "native",
			profile: "hyperframes-graph-v1",
			muted: false,
			volumeDb: -6,
		},
	};
	const first = await runtime.load({ source, signal: signal() });
	expect(first?.gain).toBeCloseTo(0.5011872336272722, 12);
	const neutral = {
		version: 1,
		mode: "native",
		profile: "hyperframes-graph-v1",
	};
	expect(identities[0].request).toMatchObject({
		source: { audio: neutral },
		sampleRate: 44100,
	});
	expect(renders[0].request).toMatchObject({
		source: { audio: neutral },
		firstFrame: 0,
		frameCount: 3,
		sampleRate: 44100,
		expectedIdentity: identity(),
	});
	const wire = JSON.stringify(renders[0].request);
	expect(wire).not.toContain("volumeDb");
	expect(wire).not.toContain("muted");
	expect(source.audio).toMatchObject({ volumeDb: -6, muted: false });
	const second = await runtime.load({
		source: { ...source, audio: { ...source.audio!, volumeDb: 6 } },
		signal: signal(),
	});
	expect(second?.data).toBe(first?.data);
	expect(second?.gain).toBeCloseTo(1.9952623149688795, 12);
	expect(identities).toHaveLength(2);
	expect(renders).toHaveLength(1);
	expect(new Float32Array(first!.data.pcm)[0]).toBe(0.125);
	expect(
		await runtime.load({
			source: { ...source, audio: { ...source.audio!, muted: true } },
			signal: signal(),
		}),
	).toBeNull();
	expect(identities).toHaveLength(2);
	expect((await runtime.load({ source, signal: signal() }))?.data).toBe(
		first?.data,
	);
	expect(identities).toHaveLength(3);
	expect(renders).toHaveLength(1);
	await runtime.invalidate();
});

test("even a cache hit must await and pass a fresh host identity preflight", async () => {
	const { runtime, hooks, identities, renders } = harness();
	const source = graphSource();
	const first = await runtime.load({ source, signal: signal() });
	const entered = deferred<void>(),
		check = deferred<ProgrammaticAudioIdentity>();
	hooks.identify = () => {
		entered.resolve();
		return check.promise;
	};
	let settled = false;
	const next = runtime.load({ source, signal: signal() }).then((result) => {
		settled = true;
		return result;
	});
	await entered.promise;
	expect(settled).toBe(false);
	expect(renders).toHaveLength(1);
	check.resolve(identity());
	expect((await next)?.data).toBe(first?.data);
	hooks.identify = async () => {
		throw Error("runtime no longer installed");
	};
	await expect(runtime.load({ source, signal: signal() })).rejects.toThrow(
		"runtime no longer installed",
	);
	expect(identities).toHaveLength(3);
	expect(renders).toHaveLength(1);
	hooks.identify = async () => identity();
	expect((await runtime.load({ source, signal: signal() }))?.data).toBe(
		first?.data,
	);
	expect(identities).toHaveLength(4);
	await runtime.invalidate();
});

test("changing native runtime identity isolates cached PCM and expected render identity", async () => {
	const { runtime, hooks, identities, renders } = harness();
	const source = graphSource();
	const first = await runtime.load({ source, signal: signal() });
	hooks.identify = async () => identity("b");
	hooks.render = async () => pcm(identity("b"));
	const second = await runtime.load({ source, signal: signal() });
	expect(second?.data).not.toBe(first?.data);
	expect(renders).toHaveLength(2);
	expect(renders[1].request).toMatchObject({ expectedIdentity: identity("b") });
	expect((await runtime.load({ source, signal: signal() }))?.data).toBe(
		second?.data,
	);
	expect(identities).toHaveLength(3);
	expect(renders).toHaveLength(2);
	await runtime.invalidate();
});

test("missing, changed, or malformed response identity is rejected and never cached", async () => {
	for (const responseIdentity of [
		undefined,
		identity("b"),
		{ ...identity(), id: "bad" },
		{ ...identity(), version: 2 },
		{ ...identity(), unknown: true },
	]) {
		const { runtime, hooks, renders } = harness();
		hooks.render = async () =>
			// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Deliberately malformed host data must be rejected before cache admission.
			({ ...pcm(), identity: responseIdentity }) as ProgrammaticAudioData;
		await expect(
			runtime.load({ source: graphSource(), signal: signal() }),
		).rejects.toThrow("identity changed");
		hooks.render = async () => pcm(identity());
		expect(
			await runtime.load({ source: graphSource(), signal: signal() }),
		).not.toBeNull();
		expect(renders).toHaveLength(2);
		await runtime.invalidate();
	}
});

test("malformed identity preflight cannot read cached PCM or start a new render", async () => {
	const { runtime, hooks, identities, renders } = harness();
	const source = graphSource();
	await runtime.load({ source, signal: signal() });
	for (const bad of [
		null,
		{ ...identity(), profile: "native" },
		{ ...identity(), id: "A".repeat(64) },
		{ ...identity(), extra: true },
	]) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Deliberately malformed host identity exercises the transport boundary.
		hooks.identify = async () => bad as ProgrammaticAudioIdentity;
		await expect(runtime.load({ source, signal: signal() })).rejects.toThrow(
			"Invalid programmatic audio runtime identity",
		);
	}
	expect(identities).toHaveLength(5);
	expect(renders).toHaveLength(1);
	await runtime.invalidate();
});

test("graph audio requires an identity provider and real Rust source/profile admission", async () => {
	const { runtime, provider, identities, renders } = harness();
	const withoutIdentity = {
		renderPng: provider.renderPng,
		renderAudio: provider.renderAudio,
	};
	await expect(
		new ProgrammaticAudioRuntime(withoutIdentity).load({
			source: graphSource(),
			signal: signal(),
		}),
	).rejects.toThrow("cannot identify");
	const source = graphSource();
	for (const malformed of [
		{ ...source, audio: { ...source.audio, profile: null } },
		{ ...source, audio: { ...source.audio, profile: "hyperframes-graph-v2" } },
		{ ...source, build: { ...source.build, engineVersion: "0.8.140" } },
		{
			...source,
			build: { ...source.build, engine: "remotion", compositionId: "Audio" },
		},
		{ ...source, build: undefined },
	]) {
		await expect(
			runtime.load({
				// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Corrupt persisted source must reach the actual Rust admission, not a mock policy.
				source: malformed as ProgrammaticSource,
				signal: signal(),
			}),
		).rejects.toThrow();
	}
	expect(identities).toHaveLength(0);
	expect(renders).toHaveLength(0);
	await runtime.invalidate();
});

test("invalidation aborts and drains in-flight identity work without allowing stale render", async () => {
	const { runtime, hooks, identities, renders } = harness();
	const entered = deferred<void>(),
		check = deferred<ProgrammaticAudioIdentity>();
	hooks.identify = () => {
		entered.resolve();
		return check.promise;
	};
	const load = runtime.load({ source: graphSource(), signal: signal() });
	const rejection = load.catch((error) => error);
	await entered.promise;
	let drained = false;
	const drain = runtime.invalidate().then(() => {
		drained = true;
	});
	expect(identities[0].signal.aborted).toBe(true);
	await Promise.resolve();
	expect(drained).toBe(false);
	check.resolve(identity());
	await drain;
	expect(await rejection).toMatchObject({ name: "AbortError" });
	expect(drained).toBe(true);
	expect(renders).toHaveLength(0);
	hooks.identify = async () => identity();
	expect(
		await runtime.load({ source: graphSource(), signal: signal() }),
	).not.toBeNull();
	expect(renders).toHaveLength(1);
	await runtime.invalidate();
});

test("caller cancellation reaches identity IO and cannot populate PCM after it settles", async () => {
	const { runtime, hooks, identities, renders } = harness();
	const entered = deferred<void>(),
		check = deferred<ProgrammaticAudioIdentity>();
	hooks.identify = () => {
		entered.resolve();
		return check.promise;
	};
	const controller = new AbortController();
	const load = runtime.load({
		source: graphSource(),
		signal: controller.signal,
	});
	const rejection = load.catch((error) => error);
	await entered.promise;
	controller.abort();
	expect(identities[0].signal.aborted).toBe(true);
	check.resolve(identity());
	expect(await rejection).toMatchObject({ name: "AbortError" });
	expect(renders).toHaveLength(0);
	await runtime.invalidate();
});

test("independently preflighted graph consumers share PCM without sharing cancellation", async () => {
	const { runtime, hooks, identities, renders } = harness();
	const entered = deferred<void>(),
		output = deferred<ProgrammaticAudioData>();
	hooks.render = () => {
		entered.resolve();
		return output.promise;
	};
	const source = graphSource(),
		controller = new AbortController();
	const first = runtime
		.load({ source, signal: controller.signal })
		.catch((error) => error);
	const second = runtime.load({
		source: { ...source, audio: { ...source.audio!, volumeDb: -6 } },
		signal: signal(),
	});
	await entered.promise;
	expect(identities).toHaveLength(2);
	expect(renders).toHaveLength(1);
	controller.abort();
	expect(await first).toMatchObject({ name: "AbortError" });
	expect(renders[0].signal.aborted).toBe(false);
	const data = pcm(identity());
	output.resolve(data);
	const retained = await second;
	expect(retained?.data).toBe(data);
	expect(retained?.gain).toBeCloseTo(0.5011872336272722, 12);
	expect((await runtime.load({ source, signal: signal() }))?.data).toBe(data);
	expect(identities).toHaveLength(3);
	expect(renders).toHaveLength(1);
	await runtime.invalidate();
});

test("legacy HyperFrames and Remotion native audio never invokes graph identity", async () => {
	for (const engine of ["hyperframes", "remotion"] as const) {
		const { runtime, hooks, identities, renders } = harness();
		const original = graphSource();
		const source: ProgrammaticSource = {
			...original,
			audio: { version: 1, mode: "native", volumeDb: -6 },
			build: {
				...original.build!,
				engine,
				...(engine === "remotion"
					? { engineVersion: "4.0.440", compositionId: "Audio" }
					: {}),
			},
		};
		hooks.identify = async () => {
			throw Error("Legacy source requested graph identity");
		};
		hooks.render = async () => pcm();
		const first = await runtime.load({ source, signal: signal() });
		expect((await runtime.load({ source, signal: signal() }))?.data).toBe(
			first?.data,
		);
		expect(identities).toHaveLength(0);
		expect(renders).toHaveLength(1);
		expect(JSON.stringify(renders[0].request)).not.toContain(
			"expectedIdentity",
		);
		await runtime.invalidate();
	}
});
