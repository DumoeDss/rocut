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

export async function renderFrameRequest({
	api,
	resources,
	handle,
	frame,
	signal,
	assertCurrent = () => {},
	maxSteps = 1,
}: {
	api: RenderFrameRequestApi;
	resources: Pick<SessionResources, "setTimeout">;
	handle: number;
	frame: FrameDescriptor;
	signal?: AbortSignal;
	assertCurrent?: () => void;
	maxSteps?: number;
}): Promise<void> {
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
		// This synchronous commit cannot be interrupted by a later JS task. No
		// claim is made that submitted GPU work can be recalled after this point.
		api.commitRenderFrameForHandle(handle, request);
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
}
