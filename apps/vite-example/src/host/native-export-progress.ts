const PROGRESS_TIMEOUT_MS = 5000;

/** Bound both response headers and body, even if a transport ignores abort. */
export async function withProgressDeadline<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	{
		signal,
		timeoutMs = PROGRESS_TIMEOUT_MS,
	}: {
		readonly signal?: AbortSignal;
		readonly timeoutMs?: number;
	} = {},
): Promise<T> {
	const controller = new AbortController();
	let rejectAbort: (reason: unknown) => void = () => {};
	const aborted = new Promise<never>((_, reject) => {
		rejectAbort = reject;
	});
	const abort = (reason: unknown) => {
		controller.abort(reason);
		rejectAbort(reason);
	};
	const onAbort = () => abort(signal?.reason ?? new Error("cancelled"));
	const timer = setTimeout(
		() => abort(new Error("native-export-progress-timeout")),
		timeoutMs,
	);
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		if (signal?.aborted) onAbort();
		return await Promise.race([
			aborted,
			Promise.resolve().then(() => {
				controller.signal.throwIfAborted();
				return operation(controller.signal);
			}),
		]);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

/** Telemetry has one active request and one replaceable latest value. */
export function createNativeExportProgress({
	report,
	onCancel,
	signal,
	timeoutMs,
}: {
	readonly report: (
		progress: number,
		signal: AbortSignal,
	) => Promise<{ cancelRequested: boolean }>;
	readonly onCancel: () => void;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}) {
	const controller = new AbortController();
	let latest: number | undefined;
	let active: Promise<void> | undefined;
	let closed = false;
	let stopped = false;
	const stop = () => {
		stopped = true;
		closed = true;
		latest = undefined;
		controller.abort(new Error("native-export-progress-stopped"));
		signal?.removeEventListener("abort", stop);
	};
	signal?.addEventListener("abort", stop, { once: true });
	if (signal?.aborted) stop();
	const drain = async () => {
		while (!stopped && latest !== undefined) {
			const progress = latest;
			latest = undefined;
			try {
				const result = await withProgressDeadline(
					(requestSignal) => report(progress, requestSignal),
					{ signal: controller.signal, timeoutMs },
				);
				if (!stopped && result.cancelRequested) {
					onCancel();
					stop();
				}
			} catch {
				// Telemetry loss neither cancels the render nor proves completion.
			}
		}
	};
	const start = () => {
		if (!active)
			active = drain().finally(() => {
				active = undefined;
				if (!stopped && latest !== undefined) start();
			});
	};
	return {
		report(progress: number) {
			if (closed || !Number.isFinite(progress)) return;
			latest = Math.min(1, Math.max(0, progress));
			start();
		},
		async finish() {
			if (closed) return;
			closed = true;
			latest = 1;
			start();
			try {
				while (active) await active;
			} finally {
				stop();
			}
		},
		stop,
	};
}
