import type { SessionResources } from "../../../editor/session/resources";
import type { FrameDescriptor } from "./types";

/** Matches the request-scoped wasm-bindgen boundary; no solver logic lives here. */
export interface RenderFrameRequestApi {
	beginRenderFrameForHandle(handle: number, frame: FrameDescriptor): number;
	advanceRenderFrameForHandle(
		handle: number,
		request: number,
		maxSteps: number,
	): boolean | Promise<boolean>;
	commitRenderFrameForHandle(handle: number, request: number): void;
	cancelRenderFrameForHandle(handle: number, request: number): void;
}

export function assertRenderFrameRequestApi(
	api: unknown,
): asserts api is RenderFrameRequestApi {
	for (const key of [
		"beginRenderFrameForHandle",
		"advanceRenderFrameForHandle",
		"commitRenderFrameForHandle",
		"cancelRenderFrameForHandle",
	] as const) {
		if (
			(typeof api !== "object" && typeof api !== "function") ||
			api === null ||
			typeof Reflect.get(api, key) !== "function"
		) {
			throw new Error(`WASM request API unavailable: ${key}`);
		}
	}
}

export class RenderCancelledError extends Error {
	readonly code = "RENDER_CANCELLED";
	constructor() {
		super("Render request cancelled.");
		this.name = "AbortError";
	}
}

export class CompositorBusyError extends Error {
	readonly code = "COMPOSITOR_BUSY";
	constructor() {
		super(
			"Active compositor work must be cancelled and drained with await close() before disposal.",
		);
		this.name = "CompositorBusyError";
	}
}

export function isRenderCancelledError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		error.name === "AbortError" &&
		"code" in error &&
		error.code === "RENDER_CANCELLED"
	);
}

/** Only the exact native abort reason proves this rejection belongs to this signal. */
export function normalizeRenderCancellation({
	error,
	signal,
}: {
	error: unknown;
	signal?: AbortSignal;
}): unknown {
	if (isRenderCancelledError(error)) return error;
	return signal?.aborted &&
		error === signal.reason &&
		error instanceof DOMException &&
		error.name === "AbortError"
		? new RenderCancelledError()
		: error;
}

export function assertRenderNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new RenderCancelledError();
}

/** A timer is a browser task, unlike Promise.resolve/queueMicrotask. */
export function yieldRenderTask({
	resources,
	signal,
}: {
	resources: Pick<SessionResources, "setTimeout">;
	signal?: AbortSignal;
}): Promise<void> {
	assertRenderNotAborted(signal);
	return new Promise((resolve, reject) => {
		const abort = () => {
			timer.cancel();
			signal?.removeEventListener("abort", abort);
			reject(new RenderCancelledError());
		};
		const timer = resources.setTimeout({
			ms: 0,
			handler: () => {
				signal?.removeEventListener("abort", abort);
				try {
					assertRenderNotAborted(signal);
					resolve();
				} catch (error) {
					reject(error);
				}
			},
		});
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
	});
}

export interface NativeFramePng {
	png: Uint8Array;
	width: number;
	height: number;
	handle: number;
	requestId: number;
	owner: string;
	generation: string;
	peakBytes: number;
	format: "rgba8unorm";
	alphaMode: "straight";
	colorSpace: "srgb";
	mimeType: "image/png";
	backend: "webgl" | "webgpu";
}

type RequestOptions = {
	api: RenderFrameRequestApi;
	resources: Pick<SessionResources, "setTimeout">;
	handle: number;
	frame: FrameDescriptor;
	signal?: AbortSignal;
	assertCurrent?: () => void;
	maxSteps?: number;
};

export function renderFrameRequest(options: RequestOptions): Promise<void> {
	return executeFrameRequest({
		...options,
		commit: (request) =>
			options.api.commitRenderFrameForHandle(options.handle, request),
	});
}

export function renderFramePngRequest(
	options: RequestOptions,
): Promise<NativeFramePng> {
	const commit = Reflect.get(options.api, "commitRenderFramePngForHandle");
	if (typeof commit !== "function")
		throw new Error("WASM native frame PNG API unavailable.");
	return executeFrameRequest({
		...options,
		commit: async (request) => {
			const result: NativeFramePng = await commit.call(
				options.api,
				options.handle,
				request,
			);
			if (
				!(result?.png instanceof Uint8Array) ||
				result.png.length < 8 ||
				result.handle !== options.handle ||
				result.requestId !== request ||
				result.width !== options.frame.width ||
				result.height !== options.frame.height ||
				![137, 80, 78, 71, 13, 10, 26, 10].every(
					(byte, index) => result.png[index] === byte,
				) ||
				!/^\d+$/.test(result.owner) ||
				!/^[1-9]\d*$/.test(result.generation) ||
				!Number.isSafeInteger(result.peakBytes) ||
				result.peakBytes < 1 ||
				result.peakBytes > 1024 ** 3 ||
				result.format !== "rgba8unorm" ||
				result.alphaMode !== "straight" ||
				result.colorSpace !== "srgb" ||
				result.mimeType !== "image/png" ||
				(result.backend !== "webgl" && result.backend !== "webgpu")
			)
				throw new Error("Invalid native frame PNG result.");
			return result;
		},
	});
}

async function executeFrameRequest<T>({
	api,
	resources,
	handle,
	frame,
	signal,
	assertCurrent = () => {},
	maxSteps = 1,
	commit,
}: RequestOptions & {
	commit: (request: number) => T | Promise<T>;
}): Promise<T> {
	const check = () => {
		assertRenderNotAborted(signal);
		assertCurrent();
	};
	check();
	if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 64)
		throw new RangeError("Render chunk size must be an integer from 1 to 64.");
	assertRenderFrameRequestApi(api);
	const request = api.beginRenderFrameForHandle(handle, frame);
	let committed = false,
		cancelled = false,
		cancellationFailure: unknown,
		failure: unknown,
		failed = false;
	let result!: T;
	const cancel = () => {
		if (cancelled || committed) return;
		cancelled = true;
		try {
			api.cancelRenderFrameForHandle(handle, request);
		} catch (error) {
			cancellationFailure = error;
		}
	};
	// Deliberately outside the compositor's queue: abort must not wait on its lock.
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		check();
		while (true) {
			const step = api.advanceRenderFrameForHandle(handle, request, maxSteps);
			// Preserve the legacy synchronous path's task/microtask timing.
			const ready = typeof step === "boolean" ? step : await step;
			check();
			if (ready) break;
			await yieldRenderTask({ resources, signal });
			check();
		}
		check();
		// Ordinary commit is synchronous; PNG commit retains the reservation
		// during asynchronous mapping and cancels without prematurely unlocking.
		const output = commit(request);
		// Await native readback retirement, even when aborted. Never race release.
		result = output instanceof Promise ? await output : output;
		committed = true;
		check();
	} catch (error) {
		failure = error;
		failed = true;
	} finally {
		signal?.removeEventListener("abort", cancel);
		if (!committed) cancel();
	}
	if (cancellationFailure !== undefined)
		throw new AggregateError(
			failed ? [failure, cancellationFailure] : [cancellationFailure],
			"Render request and cancellation cleanup failed.",
		);
	if (failed) throw failure;
	return result;
}
