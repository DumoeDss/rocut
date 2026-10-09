import * as wasm from "opencut-wasm";
import { sameImagePreprocessStructure } from "./image-preprocess-identity";
import { createImagePreprocessYield } from "./image-preprocess-yield";
import type {
	MvImagePreprocessBinding,
	MvImagePreprocessRequest,
	MvPreparedPatchCommand,
} from "@opencut/editor-contracts";
import {
	readImagePreprocessRgba,
	type ImagePreprocessReadbackInput,
} from "./image-preprocess-readback";

interface NativeOwner {
	request(binding: MvImagePreprocessBinding): MvImagePreprocessRequest;
	key(binding: MvImagePreprocessBinding): string;
	admit(bytes: number): void;
	begin(
		binding: MvImagePreprocessBinding,
		rgba: Uint8Array,
		bytes: number,
	): bigint;
	step(id: bigint, pixels: number): boolean;
	take(id: bigint, binding: MvImagePreprocessBinding): Uint8Array;
	dispose(id: bigint): void;
	free(): void;
}
interface Entry {
	controller: AbortController;
	consumers: number;
	bytes: number;
	buffer?: Uint8Array;
	promise: Promise<Uint8Array>;
}

export interface ImagePreprocessLease {
	readonly buffer: Uint8Array;
	readonly residentBytes: number;
	/** Pins this binary result until the frame's residency/realm is released. */
	release(): void;
}

/** Public residency/preparation boundary; clients never need private cache state. */
export interface ImagePreprocessAccess {
	reserve: ImagePreprocessOwner["reserve"];
	prepare: ImagePreprocessOwner["prepare"];
	dispose: ImagePreprocessOwner["dispose"];
	disposeAndDrain: ImagePreprocessOwner["disposeAndDrain"];
	releaseUnusedCache: ImagePreprocessOwner["releaseUnusedCache"];
}

function isNativeOwner(value: unknown): value is NativeOwner {
	return (
		!!value &&
		typeof value === "object" &&
		[
			"request",
			"key",
			"admit",
			"begin",
			"step",
			"take",
			"dispose",
			"free",
		].every((key) => typeof Reflect.get(value, key) === "function")
	);
}

/** Explicit owner, no global cache or iframe persistence. Caller disposal drops
 * sessions and cached binary patches. One cancelled consumer releases a lease. */
export class ImagePreprocessOwner {
	private native?: NativeOwner;
	private readonly entries = new Map<string, Entry>();
	private readonly pending = new Set<Promise<Uint8Array>>();
	private externalBytes = 0;
	private disposed = false;
	private disposalDrain: Promise<void> | undefined;
	private completeDisposalDrain: (() => void) | undefined;
	private dropUnusedCache(): void {
		for (const [key, entry] of this.entries)
			if (entry.buffer && entry.consumers === 0) {
				this.externalBytes -= entry.bytes;
				this.entries.delete(key);
			}
	}
	/** Reclaim idle preparation outputs without disposing the shared ledger. */
	releaseUnusedCache(): void {
		this.dropUnusedCache();
		this.finishDisposal();
	}
	private finishDisposal(): void {
		if (!this.disposed) return;
		this.dropUnusedCache();
		if (
			this.pending.size === 0 &&
			this.externalBytes === 0 &&
			[...this.entries.values()].every((entry) => entry.consumers === 0)
		) {
			this.entries.clear();
			this.native?.free();
			this.native = undefined;
			this.completeDisposalDrain?.();
		}
	}
	private getNative(): NativeOwner {
		if (this.disposed) throw Error("Image preprocessing owner disposed");
		if (!this.native) {
			const factory: unknown = Reflect.get(wasm, "MvImagePreprocessOwner");
			if (typeof factory !== "function")
				throw Error("Flame requires rebuilt WASM preprocessing owner");
			const instance: unknown = Reflect.construct(factory, []);
			if (!isNativeOwner(instance))
				throw Error("Invalid WASM preprocessing owner API");
			this.native = instance;
		}
		return this.native;
	}
	private admitResidency(bytes: number): void {
		if (!Number.isSafeInteger(bytes) || bytes < 0)
			throw Error("Invalid preprocessing residency");
		for (;;) {
			try {
				this.getNative().admit(this.externalBytes + bytes);
				break;
			} catch (error) {
				const cached = [...this.entries].find(
					([, entry]) => entry.buffer && entry.consumers === 0,
				);
				if (!cached) throw error;
				this.externalBytes -= cached[1].bytes;
				this.entries.delete(cached[0]);
			}
		}
		this.externalBytes += bytes;
	}
	reserve(bytes: number): () => void {
		this.admitResidency(bytes);
		let released = false;
		return () => {
			if (!released) {
				released = true;
				this.externalBytes -= bytes;
				this.finishDisposal();
			}
		};
	}
	async prepare({
		command,
		input,
		signal,
	}: {
		command: MvPreparedPatchCommand;
		input: ImagePreprocessReadbackInput;
		signal: AbortSignal;
	}): Promise<ImagePreprocessLease> {
		signal.throwIfAborted();
		const native = this.getNative(),
			{ binding } = command.request;
		if (
			native.key(binding) !== command.patchKey ||
			!sameImagePreprocessStructure({
				left: native.request(binding),
				right: command.request,
			})
		)
			throw Error(
				"Preprocessing request differs from Rust canonical identity/ROI",
			);
		if (
			!sameImagePreprocessStructure({
				left: input.request,
				right: command.request,
			}) ||
			!sameImagePreprocessStructure({
				left: input.item.resource,
				right: binding.resource,
			}) ||
			!sameImagePreprocessStructure({
				left: input.admission.resource,
				right: binding.resource,
			}) ||
			!(input.item.body instanceof ArrayBuffer) ||
			input.item.body.byteLength !== binding.resource.byteLength ||
			input.admission.decodedBytes !== binding.width * binding.height * 4 ||
			!(
				(input.admission.width === binding.width &&
					input.admission.height === binding.height) ||
				(input.admission.width === binding.height &&
					input.admission.height === binding.width)
			)
		)
			throw Error(
				"Preprocessing input does not match the canonical command binding",
			);
		input = {
			...input,
			request: structuredClone(command.request),
			item: { ...input.item, resource: structuredClone(input.item.resource) },
			admission: structuredClone(input.admission),
			limits: structuredClone(input.limits),
		};
		let entry = this.entries.get(command.patchKey);
		if (entry?.controller.signal.aborted) {
			this.entries.delete(command.patchKey);
			entry = undefined;
		}
		if (!entry) {
			const controller = new AbortController();
			entry = {
				controller,
				consumers: 0,
				bytes: 0,
				promise: Promise.resolve(new Uint8Array()),
			};
			const current = entry;
			this.entries.set(command.patchKey, current);
			current.promise = this.run({ input, signal: controller.signal })
				.then((buffer) => {
					controller.signal.throwIfAborted();
					// Bounded opaque key, headers, controller/Promise and cache entry.
					const bytes = buffer.byteLength + 20480;
					this.admitResidency(bytes);
					current.bytes = bytes;
					current.buffer = buffer;
					return buffer;
				})
				.catch((error) => {
					if (this.entries.get(command.patchKey) === current)
						this.entries.delete(command.patchKey);
					throw error;
				});
			this.pending.add(current.promise);
			void current.promise.then(
				() => {
					this.pending.delete(current.promise);
					this.finishDisposal();
				},
				() => {
					this.pending.delete(current.promise);
					this.finishDisposal();
				},
			);
		}
		const current = entry;
		current.consumers++;
		return new Promise((resolve, reject) => {
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				signal.removeEventListener("abort", abort);
				if (--current.consumers === 0 && !current.buffer)
					current.controller.abort(
						new DOMException("No preprocessing consumers", "AbortError"),
					);
				this.finishDisposal();
			};
			const abort = () => {
				release();
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
			current.promise.then(
				(value) => {
					if (!released) {
						signal.removeEventListener("abort", abort);
						resolve({ buffer: value, residentBytes: current.bytes, release });
					}
				},
				(error) => {
					if (!released) {
						release();
						reject(error);
					}
				},
			);
			if (signal.aborted) abort();
		});
	}
	private async run({
		input,
		signal,
	}: {
		input: ImagePreprocessReadbackInput;
		signal: AbortSignal;
	}): Promise<Uint8Array> {
		const native = this.getNative(),
			{ binding } = input.request;
		// Snapshot + port encoded copies, decoded bitmap and full Canvas readback.
		const release = this.reserve(
			input.item.body.byteLength * 3 +
				binding.width * binding.height * 8 +
				input.request.roi.width * input.request.roi.height * 8 +
				8192,
		);
		input = {
			...input,
			item: { ...input.item, body: input.item.body.slice(0) },
		};
		let preparationDone = false,
			realmDisposed = false;
		const releaseWhenUnused = () => {
			if (preparationDone && realmDisposed) release();
		};
		const timeout = new AbortController(),
			linked = AbortSignal.any([signal, timeout.signal]);
		const timer = setTimeout(
			() => timeout.abort(Error("Image preprocessing timed out after 5000 ms")),
			5000,
		);
		let id: bigint | undefined;
		let cooperative: ReturnType<typeof createImagePreprocessYield> | undefined;
		try {
			const rgba = await readImagePreprocessRgba({
				input,
				signal: linked,
				onDisposed: () => {
					realmDisposed = true;
					releaseWhenUnused();
				},
			});
			linked.throwIfAborted();
			id = native.begin(binding, rgba, this.externalBytes);
			cooperative = createImagePreprocessYield(linked);
			while (!native.step(id, 16384)) {
				await cooperative.wait();
				linked.throwIfAborted();
			}
			linked.throwIfAborted();
			return native.take(id, binding);
		} finally {
			cooperative?.close();
			clearTimeout(timer);
			if (id !== undefined) native.dispose(id);
			preparationDone = true;
			releaseWhenUnused();
		}
	}
	/** Drains pending work, pinned outputs and realm grace before replacement. */
	disposeAndDrain(): Promise<void> {
		this.disposalDrain ??= new Promise<void>((resolve) => {
			this.completeDisposalDrain = resolve;
		});
		this.dispose();
		this.finishDisposal();
		return this.disposalDrain;
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const entry of this.entries.values())
			entry.controller.abort(
				new DOMException("Preprocessing owner disposed", "AbortError"),
			);
		// Pending sessions, pinned output leases and grace-period reservations all
		// drain before freeing WASM; a late callback cannot decrement a reset ledger.
		this.finishDisposal();
	}
}
