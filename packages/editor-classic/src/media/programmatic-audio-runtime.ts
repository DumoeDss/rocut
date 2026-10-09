import {
	programmaticAudioPolicyJson,
	resolveProgrammaticAudioSourceJson,
} from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type {
	ProgrammaticAudioData,
	ProgrammaticAudioIdentity,
	ProgrammaticFrameProvider,
} from "@opencut/editor-ports/host";
import { isProgrammaticAudioIdentity } from "@opencut/editor-ports/host";

interface Entry {
	controller: AbortController;
	promise: Promise<ProgrammaticAudioData>;
	data?: ProgrammaticAudioData;
	consumers: number;
}

/** Session-scoped source audio IO/cache. Rust owns all timing and admission.
 * Independent callers can cancel without cancelling another consumer's export.
 */
export class ProgrammaticAudioRuntime {
	private entries = new Map<string, Entry>();
	private active = new Set<Entry>();
	private generation = 0;
	private bytes = 0;
	private buffers = new WeakMap<ProgrammaticAudioData, AudioBuffer>();
	private identities = new Map<
		AbortController,
		Promise<ProgrammaticAudioIdentity>
	>();

	constructor(private readonly provider?: ProgrammaticFrameProvider) {}

	private async identify({
		source,
		sampleRate,
		signal,
	}: {
		source: ProgrammaticSource;
		sampleRate: number;
		signal: AbortSignal;
	}) {
		if (!this.provider?.getAudioIdentity)
			throw Error(
				"This host cannot identify the HyperFrames audio graph runtime",
			);
		const controller = new AbortController();
		const lifetime = AbortSignal.any([signal, controller.signal]);
		const work = Promise.resolve().then(() => {
			lifetime.throwIfAborted();
			return this.provider!.getAudioIdentity!({
				request: { source, sampleRate },
				signal: lifetime,
			});
		});
		this.identities.set(controller, work);
		try {
			const identity = await work;
			signal.throwIfAborted();
			controller.signal.throwIfAborted();
			if (!isProgrammaticAudioIdentity(identity))
				throw Error("Invalid programmatic audio runtime identity");
			return Object.freeze({ ...identity });
		} finally {
			this.identities.delete(controller);
		}
	}

	async load({
		source,
		signal,
		sampleRate = 44100,
	}: {
		source: ProgrammaticSource;
		signal: AbortSignal;
		sampleRate?: number;
	}): Promise<{ data: ProgrammaticAudioData; gain: number } | null> {
		signal.throwIfAborted();
		if (source.audio === undefined) return null;
		const generation = this.generation;
		const resolved = JSON.parse(
			resolveProgrammaticAudioSourceJson(
				JSON.stringify({ source, sampleRate }),
			),
		);
		if (resolved.error) throw Error(resolved.error);
		if (!resolved.plan || resolved.plan.muted) return null;
		if (!this.provider?.renderAudio)
			throw Error("This host cannot render the programmatic source soundtrack");
		const range = resolved.plan.range,
			limits = JSON.parse(programmaticAudioPolicyJson());
		// Clip gain/mute are applied by the editor, not baked into source PCM.
		const audio = { ...source.audio };
		delete audio.muted;
		delete audio.volumeDb;
		const content = structuredClone({ ...source, audio });
		const identity =
			content.audio?.profile === "hyperframes-graph-v1"
				? await this.identify({ source: content, sampleRate, signal })
				: undefined;
		signal.throwIfAborted();
		if (this.generation !== generation)
			throw new DOMException(
				"Programmatic audio source invalidated",
				"AbortError",
			);
		const key = JSON.stringify({ source: content, sampleRate, identity });
		let entry = this.entries.get(key);
		if (!entry) {
			const created: Entry = {
				controller: new AbortController(),
				consumers: 0,
				promise: undefined!,
			};
			this.entries.set(key, created);
			this.active.add(created);
			created.promise = Promise.resolve()
				.then(() => {
					created.controller.signal.throwIfAborted();
					return this.provider!.renderAudio!({
						request: {
							source: content,
							firstFrame: 0,
							frameCount: range.frameCount,
							sampleRate,
							...(identity ? { expectedIdentity: identity } : {}),
						},
						signal: created.controller.signal,
					});
				})
				.then((data) => {
					created.controller.signal.throwIfAborted();
					if (this.generation !== generation)
						throw new DOMException(
							"Programmatic audio source invalidated",
							"AbortError",
						);
					if (
						!(data.pcm instanceof ArrayBuffer) ||
						data.channels !== 2 ||
						data.sampleRate !== sampleRate ||
						data.frames !== range.outputFrames ||
						data.sampleOrigin !== 0 ||
						typeof data.hasAudio !== "boolean" ||
						data.pcm.byteLength !== range.outputFrames * 8 ||
						data.pcm.byteLength > limits.maxPcmBytes
					)
						throw Error("Invalid programmatic audio PCM response");
					if (
						identity &&
						(!isProgrammaticAudioIdentity(data.identity) ||
							data.identity.id !== identity.id)
					)
						throw Error("Programmatic audio runtime identity changed");
					if (!identity && data.identity !== undefined)
						throw Error(
							"Unexpected graph runtime identity for legacy source audio",
						);
					const view = new DataView(data.pcm);
					for (let offset = 0; offset < view.byteLength; offset += 4)
						if (!Number.isFinite(view.getFloat32(offset, true)))
							throw Error("Non-finite programmatic audio PCM");
					created.data = data;
					this.bytes += data.pcm.byteLength;
					for (const [oldKey, old] of this.entries) {
						if (this.bytes <= limits.maxPcmBytes) break;
						if (old !== created && old.data) {
							this.entries.delete(oldKey);
							this.bytes -= old.data.pcm.byteLength;
						}
					}
					return data;
				})
				.catch((error) => {
					if (this.entries.get(key) === created) this.entries.delete(key);
					throw error;
				})
				.finally(() => this.active.delete(created));
			entry = created;
		} else if (entry.data) {
			this.entries.delete(key);
			this.entries.set(key, entry);
		}
		const selected = entry;
		selected.consumers++;
		let abort: () => void;
		const data = await new Promise<ProgrammaticAudioData>((resolve, reject) => {
			abort = () =>
				reject(
					signal.reason ??
						new DOMException("Audio load cancelled", "AbortError"),
				);
			signal.addEventListener("abort", abort, { once: true });
			selected.promise.then(resolve, reject);
			if (signal.aborted) abort();
		}).finally(() => {
			signal.removeEventListener("abort", abort!);
			selected.consumers--;
			if (!selected.consumers && !selected.data) {
				selected.controller.abort();
				if (this.entries.get(key) === selected) this.entries.delete(key);
			}
		});
		signal.throwIfAborted();
		if (this.generation !== generation)
			throw new DOMException(
				"Programmatic audio source invalidated",
				"AbortError",
			);
		return data.hasAudio ? { data, gain: resolved.plan.gain } : null;
	}

	toAudioBuffer({
		data,
		context,
	}: {
		data: ProgrammaticAudioData;
		context: Pick<AudioContext, "createBuffer">;
	}): AudioBuffer {
		const existing = this.buffers.get(data);
		if (existing) return existing;
		const buffer = context.createBuffer(2, data.frames, data.sampleRate),
			view = new DataView(data.pcm);
		for (let channel = 0; channel < 2; channel++) {
			const samples = buffer.getChannelData(channel);
			for (let i = 0; i < data.frames; i++)
				samples[i] = view.getFloat32(i * 8 + channel * 4, true);
		}
		this.buffers.set(data, buffer);
		return buffer;
	}

	async invalidate(): Promise<void> {
		this.generation++;
		this.entries.clear();
		this.bytes = 0;
		this.buffers = new WeakMap();
		const active = [...this.active];
		const identities = [...this.identities];
		for (const entry of active) entry.controller.abort();
		for (const [controller] of identities) controller.abort();
		await Promise.allSettled([
			...active.map((entry) => entry.promise),
			...identities.map(([, work]) => work),
		]);
	}
}
