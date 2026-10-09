/** Abort an await even if a platform/provider promise ignores cancellation.
 * Its late completion stays observed; no author pixels or result are published. */
export function awaitImagePreprocessDeadline<T>({
	promise,
	signal,
}: {
	promise: Promise<T>;
	signal: AbortSignal;
}): Promise<T> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				if (signal.aborted) reject(signal.reason);
				else resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
		if (signal.aborted) abort();
	});
}
