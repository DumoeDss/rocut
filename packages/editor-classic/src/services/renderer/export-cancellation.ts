export class ExportCancelledError extends Error {
	constructor() {
		super("Export cancelled.");
		this.name = "ExportCancelledError";
	}
}

/** Detach the abort listener on every frame; a shared pending promise leaks waiters. */
export function waitForExportOperation<T>({
	signal,
	operation,
}: {
	signal: AbortSignal;
	operation: () => Promise<T>;
}): Promise<T> {
	if (signal.aborted) return Promise.reject(new ExportCancelledError());
	return new Promise<T>((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(new ExportCancelledError());
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			operation().then(
				(value) => {
					signal.removeEventListener("abort", abort);
					resolve(value);
				},
				(error) => {
					signal.removeEventListener("abort", abort);
					reject(error);
				},
			);
		} catch (error) {
			signal.removeEventListener("abort", abort);
			reject(error);
		}
	});
}
