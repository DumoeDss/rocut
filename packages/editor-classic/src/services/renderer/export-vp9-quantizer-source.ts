import type { EncodedVideoPacketSource } from "mediabunny";
import { ExportCancelledError } from "./export-cancellation";
import {
	browserVp9QuantizerPlatform,
	validateVp9QuantizerOptions,
	vp9FrameMicroseconds,
	type Vp9QuantizerEncoder,
	type Vp9QuantizerFrameTiming,
	type Vp9QuantizerPlatform,
	type Vp9QuantizerSourceOptions,
} from "./export-vp9-quantizer-platform";
import { Vp9QuantizerWrites } from "./export-vp9-quantizer-writes";

export type {
	Vp9QuantizerFrameTiming,
	Vp9QuantizerPlatform,
	Vp9QuantizerSourceOptions,
} from "./export-vp9-quantizer-platform";

/**
 * Explicit native VP9 quality control feeding Mediabunny's public packet source.
 * Connect source to a started Output before adding frames. One producer must
 * await each add before reusing its canvas. add means submitted, not muxed.
 * close flushes/drains this track; Output.finalize/cancel belong to the caller.
 */
export class ExportVp9QuantizerSource {
	readonly source: EncodedVideoPacketSource;
	private readonly config: VideoEncoderConfig;
	private readonly limits;
	private readonly writes: Vp9QuantizerWrites;
	private readonly timings = new Map<number, Vp9QuantizerFrameTiming>();
	private readonly waiters = new Set<() => void>();
	private readonly terminalWaiters = new Set<() => void>();
	private readonly quantizer: number;
	private readonly signal?: AbortSignal;
	private encoder?: Vp9QuantizerEncoder;
	private initialization?: Promise<void>;
	private adding?: Promise<void>;
	private flushing?: Promise<void>;
	private closing?: Promise<void>;
	private closed = false;
	private firstError?: Error;
	private lastTimestamp = -1;
	private sawPacket = false;
	private readonly platform: Vp9QuantizerPlatform;

	constructor({
		options,
		platform = browserVp9QuantizerPlatform,
	}: {
		options: Vp9QuantizerSourceOptions;
		platform?: Vp9QuantizerPlatform;
	}) {
		this.platform = platform;
		this.limits = validateVp9QuantizerOptions(options);
		this.config = structuredClone(options.config);
		this.quantizer = options.quantizer;
		this.signal = options.signal;
		this.source = platform.createSource();
		this.writes = new Vp9QuantizerWrites({
			source: this.source,
			maxBytes: this.limits.maxPendingBytes,
			fail: (error) => this.fail(error),
			changed: this.changed,
		});
		this.signal?.addEventListener("abort", this.abort, { once: true });
		if (this.signal?.aborted) this.cancel();
	}

	initialize(): Promise<void> {
		if (!this.initialization && (this.closing || this.closed))
			return Promise.reject(this.firstError ?? Error("VP9 source is closing."));
		this.initialization ??= this.startEncoder();
		return this.initialization;
	}

	add({
		canvas,
		timing,
	}: {
		canvas: HTMLCanvasElement | OffscreenCanvas;
		timing: Vp9QuantizerFrameTiming;
	}): Promise<void> {
		if (this.closing || this.closed)
			return Promise.reject(this.firstError ?? Error("VP9 source is closing."));
		if (this.adding)
			return Promise.reject(
				Error("Await the previous VP9 canvas submission first."),
			);
		const operation = this.submit({ canvas, timing: { ...timing } });
		this.adding = operation;
		void operation.then(
			() => {
				this.adding = undefined;
			},
			() => {
				this.adding = undefined;
			},
		);
		return operation;
	}

	/** Finish this track exactly once, including delayed native outputs and writes. */
	close(): Promise<void> {
		this.closing ??= this.finish();
		return this.closing;
	}

	/**
	 * Immediate local cancellation. Already-started public mux writes cannot be
	 * aborted here; their rejections stay observed. The Output owner must cancel it.
	 */
	cancel(): void {
		if (!this.closed) this.fail(new ExportCancelledError());
	}

	private readonly abort = () => this.cancel();
	private readonly changed = () => {
		for (const resolve of this.waiters) resolve();
		this.waiters.clear();
	};

	private check(): void {
		if (this.firstError) throw this.firstError;
	}

	private fail(error: unknown): void {
		this.firstError ??= error instanceof Error ? error : Error(String(error));
		this.timings.clear();
		this.writes.stop();
		this.releaseEncoder();
		this.signal?.removeEventListener("abort", this.abort);
		this.changed();
		for (const resolve of this.terminalWaiters) resolve();
		this.terminalWaiters.clear();
	}

	private releaseEncoder(): void {
		const encoder = this.encoder;
		this.encoder = undefined;
		if (!encoder) return;
		encoder.removeEventListener("dequeue", this.changed);
		try {
			if (encoder.state !== "closed") encoder.close();
		} catch (error) {
			this.firstError ??= error instanceof Error ? error : Error(String(error));
		}
	}

	private async observe<T>(operation: Promise<T>): Promise<T> {
		// Each waiter has a finite lifetime; a never-settling native probe cannot
		// retain one abort listener per frame or create an encoder after cancel.
		// Native calls may synchronously invoke an error callback before returning.
		void operation.catch(() => {});
		this.check();
		let changed!: () => void;
		const stopped = new Promise<never>((_, reject) => {
			changed = () => {
				if (this.firstError) reject(this.firstError);
			};
			this.terminalWaiters.add(changed);
		});
		try {
			return await Promise.race([operation, stopped]);
		} finally {
			this.terminalWaiters.delete(changed);
		}
	}

	private async startEncoder(): Promise<void> {
		try {
			this.check();
			if (this.closed) throw Error("VP9 source is closed.");
			const support = await this.observe(
				this.platform.isConfigSupported(structuredClone(this.config)),
			);
			this.check();
			if (
				!support.supported ||
				!support.config ||
				(["codec", "width", "height", "alpha", "bitrateMode"] as const).some(
					(key) => support.config![key] !== this.config[key],
				)
			)
				throw Error(
					"The native encoder does not support the requested VP9 quantizer mode.",
				);
			const encoder = this.platform.createEncoder({
				output: (chunk, metadata) => this.receive({ chunk, metadata }),
				error: (error) => {
					if (!this.closed && !this.firstError) this.fail(error);
				},
			});
			this.encoder = encoder;
			if (this.firstError) {
				this.releaseEncoder();
				this.check();
			}
			encoder.addEventListener("dequeue", this.changed);
			encoder.configure(structuredClone(this.config));
			this.check();
		} catch (error) {
			this.fail(error);
			this.check();
		}
	}

	private async submit({
		canvas,
		timing,
	}: {
		canvas: HTMLCanvasElement | OffscreenCanvas;
		timing: Vp9QuantizerFrameTiming;
	}): Promise<void> {
		try {
			this.check();
			const microseconds = vp9FrameMicroseconds(timing);
			if (microseconds.timestamp <= this.lastTimestamp)
				throw Error(
					"VP9 frame timestamps must be strictly increasing and unique in microseconds.",
				);
			await this.initialize();
			await this.waitForCapacity();
			this.check();
			const frame = this.platform.createFrame({ canvas, init: microseconds });
			try {
				this.timings.set(microseconds.timestamp, timing);
				this.lastTimestamp = microseconds.timestamp;
				const options: VideoEncoderEncodeOptions & {
					vp9: { quantizer: number };
				} = {
					keyFrame: timing.keyFrame,
					vp9: { quantizer: this.quantizer },
				};
				this.encoder!.encode(frame, options);
				this.check();
			} catch (error) {
				this.fail(error);
			} finally {
				try {
					frame.close();
				} catch (error) {
					this.fail(error);
				}
			}
			this.check();
		} catch (error) {
			this.fail(error);
			this.check();
		}
	}

	private async waitForCapacity(): Promise<void> {
		while (true) {
			this.check();
			const full =
				this.timings.size + this.writes.count >= this.limits.maxPendingPackets;
			if (
				!full &&
				this.encoder!.encodeQueueSize < this.limits.maxEncodeQueueSize
			)
				return;
			// A codec can dequeue inputs while retaining frames internally. Flush at
			// the finite reservation boundary rather than waiting forever for the
			// next input to unlock those outputs or growing the timing map forever.
			if (full && this.timings.size && this.encoder!.encodeQueueSize === 0)
				await this.flushEncoder();
			else await new Promise<void>((resolve) => this.waiters.add(resolve));
		}
	}

	private receive({
		chunk,
		metadata,
	}: {
		chunk: EncodedVideoChunk;
		metadata?: EncodedVideoChunkMetadata;
	}): void {
		if (this.firstError || this.closed) return;
		try {
			const timing = this.timings.get(chunk.timestamp);
			if (!timing)
				throw Error("VP9 output has an unknown or duplicate frame timestamp.");
			if (timing.keyFrame && chunk.type !== "key")
				throw Error("VP9 encoder did not honor the requested keyframe.");
			if (!this.sawPacket && !metadata?.decoderConfig)
				throw Error("The first VP9 packet is missing decoder metadata.");
			const packet = this.platform.packetFromChunk(chunk).clone({
				timestamp: timing.timestamp,
				duration: timing.duration,
			});
			this.timings.delete(chunk.timestamp);
			this.sawPacket = true;
			this.writes.add({
				packet,
				metadata:
					metadata === undefined ? undefined : structuredClone(metadata),
			});
			this.changed();
		} catch (error) {
			this.fail(error);
		}
	}

	private flushEncoder(): Promise<void> {
		this.flushing ??= (async () => {
			try {
				this.check();
				await this.observe(this.encoder!.flush());
				this.check();
				if (this.timings.size)
					throw Error(
						"VP9 encoder flush completed with missing frame packets.",
					);
			} catch (error) {
				this.fail(error);
				this.check();
			}
		})().finally(() => {
			this.flushing = undefined;
		});
		return this.flushing;
	}

	private async finish(): Promise<void> {
		try {
			this.check();
			if (this.adding) await this.adding;
			if (this.initialization) await this.initialization;
			if (this.encoder) await this.flushEncoder();
			while (this.writes.count) {
				this.check();
				await new Promise<void>((resolve) => this.waiters.add(resolve));
			}
			this.check();
			this.source.close();
			this.releaseEncoder();
			this.check();
			this.closed = true;
			this.signal?.removeEventListener("abort", this.abort);
		} catch (error) {
			this.fail(error);
			this.check();
		}
	}
}
