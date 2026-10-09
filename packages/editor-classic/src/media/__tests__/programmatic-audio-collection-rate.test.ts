import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { UNIMPLEMENTED_RUNTIME_GPU } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import { InMemoryRuntimeResourceHost } from "@opencut/editor-ports/in-memory";
import {
	planAudioSampleWindow,
	programmaticAudioPolicyJson,
	resolveProgrammaticAudioSourceJson,
} from "opencut-wasm";
import { createSessionResources } from "../../editor/session/session-resources";
import type { SceneTracks } from "../../timeline/types";
import { mediaTime } from "../../wasm";
import { createTimelineAudioBuffer } from "../audio";
import { collectProgrammaticAudio } from "../programmatic-audio";
import { ProgrammaticAudioRuntime } from "../programmatic-audio-runtime";
import {
	graphSource,
	identity,
	signal,
} from "./programmatic-audio-graph-fixture";

function plan({ source, sampleRate }: { source: unknown; sampleRate: number }) {
	const result: {
		error?: string;
		plan?: { range: { outputFrames: number; frameCount: number } };
	} = JSON.parse(
		resolveProgrammaticAudioSourceJson(JSON.stringify({ source, sampleRate })),
	);
	if (result.error || !result.plan)
		throw Error(result.error ?? "Missing real Rust audio plan");
	return result.plan;
}

/** Only the browser's PCM storage shell is substituted; it never resamples. */
function context(sampleRate: number): AudioContext {
	const shell = {
		sampleRate,
		// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the native Web Audio createBuffer signature.
		createBuffer(channels: number, length: number, rate: number) {
			const data = Array.from(
				{ length: channels },
				() => new Float32Array(length),
			);
			return {
				sampleRate: rate,
				length,
				numberOfChannels: channels,
				duration: length / rate,
				getChannelData: (channel: number) => data[channel],
			};
		},
	};
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- These collector/mixer paths only use sampleRate/createBuffer; no browser or alternate geometry implementation is involved.
	return shell as unknown as AudioContext;
}

function tracks(source: ProgrammaticSource): SceneTracks {
	return {
		main: {
			id: "main",
			name: "Main",
			type: "video",
			elements: [],
			muted: false,
			hidden: false,
		},
		overlay: [
			{
				id: "graphics",
				name: "Sources",
				type: "graphic",
				hidden: false,
				elements: [
					{
						id: "source",
						type: "graphic",
						name: "Source",
						definitionId: "programmatic",
						params: {},
						programmatic: source,
						startTime: mediaTime({ ticks: 12000 }),
						duration: mediaTime({ ticks: 8000 }),
						trimStart: mediaTime({ ticks: 4000 }),
						trimEnd: mediaTime({ ticks: 0 }),
					},
				],
			},
		],
		audio: [],
	};
}

function harness() {
	const renders: Array<{
		source: unknown;
		sampleRate: number;
		frames: number;
	}> = [];
	const identities: unknown[] = [];
	const provider: ProgrammaticFrameProvider = {
		async renderPng() {
			throw Error("Unexpected picture IO");
		},
		async getAudioIdentity({ request }) {
			identities.push(request);
			return identity();
		},
		async renderAudio({ request }) {
			if (!request || typeof request !== "object")
				throw Error("Expected audio request");
			const source: unknown = Reflect.get(request, "source");
			const sampleRate: unknown = Reflect.get(request, "sampleRate");
			if (typeof sampleRate !== "number")
				throw Error("Expected explicit sample rate");
			const geometry = plan({ source, sampleRate }).range;
			expect(Reflect.get(request, "firstFrame")).toBe(0);
			expect(Reflect.get(request, "frameCount")).toBe(geometry.frameCount);
			renders.push({ source, sampleRate, frames: geometry.outputFrames });
			return {
				pcm: new Float32Array(geometry.outputFrames * 2).fill(0.125).buffer,
				sampleRate,
				channels: 2,
				frames: geometry.outputFrames,
				sampleOrigin: 0,
				hasAudio: true,
				identity: identity(),
			};
		},
	};
	const runtime = new ProgrammaticAudioRuntime(provider);
	const collect = ({
		deviceRate,
		sampleRate,
		source = graphSource(),
	}: {
		deviceRate: number;
		sampleRate?: 44100 | 48000;
		source?: ProgrammaticSource;
	}) => {
		const options = {
			tracks: tracks(source),
			runtime,
			audioContext: context(deviceRate),
			signal: signal(),
			...(sampleRate === undefined ? {} : { sampleRate }),
		};
		return collectProgrammaticAudio(options);
	};
	return { runtime, collect, renders, identities };
}

test("collector requests the supported device rate and isolates 44.1/48 kHz cache entries", async () => {
	const h = harness();
	try {
		const low = await h.collect({ deviceRate: 44100 });
		const high = await h.collect({ deviceRate: 48000 });
		expect(h.renders.map((call) => call.sampleRate)).toEqual([44100, 48000]);
		for (const [result, sampleRate] of [
			[low, 44100],
			[high, 48000],
		] as const) {
			expect(result).toHaveLength(1);
			expect(result[0].buffer.sampleRate).toBe(sampleRate);
			expect(result[0].buffer.length).toBe(
				plan({ source: graphSource(), sampleRate }).range.outputFrames,
			);
			expect(result[0]).toMatchObject({
				startTime: 0.1,
				duration: 8000 / 120000,
				trimStart: 4000 / 120000,
				trimEnd: 0,
			});
		}
		expect(low[0].buffer).not.toBe(high[0].buffer);
		expect((await h.collect({ deviceRate: 44100 }))[0].buffer).toBe(
			low[0].buffer,
		);
		expect((await h.collect({ deviceRate: 48000 }))[0].buffer).toBe(
			high[0].buffer,
		);
		expect(h.renders).toHaveLength(2);
	} finally {
		await h.runtime.invalidate();
	}
});

test("explicit collector output rate overrides the AudioContext device rate in both directions", async () => {
	const h = harness();
	try {
		const low = await h.collect({ deviceRate: 48000, sampleRate: 44100 });
		const high = await h.collect({ deviceRate: 44100, sampleRate: 48000 });
		expect(low[0].buffer.sampleRate).toBe(44100);
		expect(high[0].buffer.sampleRate).toBe(48000);
		expect(h.renders.map((call) => call.sampleRate)).toEqual([44100, 48000]);
	} finally {
		await h.runtime.invalidate();
	}
});

test("timeline mixer forwards its output rate to the real collector despite a different device rate", async () => {
	const h = harness();
	let sequence = 0;
	const resources = createSessionResources({
		runtimeResources: new InMemoryRuntimeResourceHost(),
		runtimeGpu: UNIMPLEMENTED_RUNTIME_GPU,
		nextId: ({ scope }) => `${scope}-${++sequence}`,
	});
	try {
		for (const [deviceRate, sampleRate] of [
			[48000, 44100],
			[44100, 48000],
		] as const) {
			const startTime = 12000;
			const duration = 8000;
			const mixed = await createTimelineAudioBuffer({
				tracks: tracks(graphSource()),
				mediaAssets: [],
				startTime,
				duration,
				sampleRate,
				audioContext: context(deviceRate),
				resources,
				programmaticAudio: h.runtime,
				signal: signal(),
			});
			expect(mixed).not.toBeNull();
			if (!mixed) throw Error("Expected mixed programmatic audio");
			expect(mixed.sampleRate).toBe(sampleRate);
			expect(mixed.length).toBe(
				planAudioSampleWindow({ startTime, duration, sampleRate })!
					.outputLength,
			);
			expect(mixed.numberOfChannels).toBe(2);
			for (let channel = 0; channel < mixed.numberOfChannels; channel++) {
				expect(
					mixed.getChannelData(channel).every((value) => value === 0.125),
				).toBe(true);
			}
		}
		expect(h.renders.map((call) => call.sampleRate)).toEqual([44100, 48000]);
		expect(resources.inspect().audioContext.created).toBe(0);
	} finally {
		await h.runtime.invalidate();
		await resources.disposeAll();
	}
});

test("unsupported device rate uses the existing 44.1 kHz compatibility default", async () => {
	const policy: { sampleRates: number[] } = JSON.parse(
		programmaticAudioPolicyJson(),
	);
	expect(policy.sampleRates).not.toContain(96000);
	expect(policy.sampleRates).toContain(44100);
	const h = harness();
	try {
		const collected = await h.collect({ deviceRate: 96000 });
		expect(h.renders[0].sampleRate).toBe(44100);
		expect(collected[0].buffer.sampleRate).toBe(44100);
		expect(collected[0].buffer.length).toBe(
			plan({ source: graphSource(), sampleRate: 44100 }).range.outputFrames,
		);
	} finally {
		await h.runtime.invalidate();
	}
});

test("collector source gain and mute remain outside cached raw PCM", async () => {
	const h = harness();
	const source: ProgrammaticSource = {
		...graphSource(),
		audio: { ...graphSource().audio!, volumeDb: -6, muted: false },
	};
	try {
		const low = await h.collect({ deviceRate: 48000, source });
		const high = await h.collect({
			deviceRate: 48000,
			source: { ...source, audio: { ...source.audio!, volumeDb: 6 } },
		});
		expect(low[0].volume).toBeCloseTo(0.5011872336272722, 12);
		expect(high[0].volume).toBeCloseTo(1.9952623149688795, 12);
		expect(low[0].buffer).toBe(high[0].buffer);
		expect(low[0].buffer.getChannelData(0)[0]).toBe(0.125);
		expect(low[0].buffer.getChannelData(1)[0]).toBe(0.125);
		expect(h.renders).toHaveLength(1);
		expect(h.renders[0].source).toMatchObject({
			audio: { version: 1, mode: "native", profile: "hyperframes-graph-v1" },
		});
		expect(JSON.stringify(h.renders[0].source)).not.toContain("volumeDb");
		expect(JSON.stringify(h.renders[0].source)).not.toContain("muted");
		const before = h.identities.length;
		expect(
			await h.collect({
				deviceRate: 48000,
				source: { ...source, audio: { ...source.audio!, muted: true } },
			}),
		).toEqual([]);
		expect(h.identities).toHaveLength(before);
		expect(h.renders).toHaveLength(1);
		expect(source.audio).toMatchObject({ volumeDb: -6, muted: false });
	} finally {
		await h.runtime.invalidate();
	}
});

test("invalid direct runtime rate still fails real Rust admission before any Host IO", async () => {
	const h = harness();
	try {
		for (const sampleRate of [96000, 32000, 0, -1, 44100.5, Number.NaN]) {
			await expect(
				h.runtime.load({
					source: graphSource(),
					signal: signal(),
					sampleRate,
				}),
			).rejects.toThrow();
		}
		expect(h.identities).toHaveLength(0);
		expect(h.renders).toHaveLength(0);
	} finally {
		await h.runtime.invalidate();
	}
});
