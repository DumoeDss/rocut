/** Revision hydration, not a renderer retry: existing publication guards remain live. */
export function createProjectReadiness({
	reload,
	schedule,
}: {
	reload: () => Promise<void>;
	/** Preview-only debounce; requests cancel it and flush immediately. */
	schedule: (run: () => void) => () => void;
}) {
	let dirty = false;
	let running: Promise<void> | undefined;
	let cancelScheduled: (() => void) | undefined;
	let failure: unknown;
	let failed = false;
	function cancelPreview() {
		cancelScheduled?.();
		cancelScheduled = undefined;
	}
	function schedulePreview() {
		cancelPreview();
		cancelScheduled = schedule(() => {
			cancelScheduled = undefined;
			void flush().catch(() => undefined);
		});
	}
	function flush(): Promise<void> {
		cancelPreview();
		if (running) return running;
		if (failed) return Promise.reject(failure);
		if (!dirty) return Promise.resolve();
		// Publish the shared flight before calling loadProject: reentrant requests
		// and newer revision events must observe this same hydration operation.
		running = Promise.resolve()
			.then(async () => {
				while (dirty) {
					dirty = false;
					await reload();
				}
			})
			.catch((error: unknown) => {
				failure = error;
				failed = true;
				throw error;
			})
			.finally(() => {
				running = undefined;
				if (dirty && !failed) schedulePreview();
			});
		return running;
	}
	return {
		changed() {
			dirty = true;
			failed = false;
			failure = undefined;
			if (running) return;
			schedulePreview();
		},
		whenReady(signal?: AbortSignal): Promise<void> {
			if (signal?.aborted) return Promise.reject(signal.reason);
			const ready = (async () => {
				// Recheck after settlement as well: a notification can arrive in the
				// flight's finalization microtasks. This consumes new revisions only,
				// never retries a failed reload or an already-started renderer request.
				do {
					await flush();
				} while (dirty && !failed);
			})();
			if (!signal) return ready;
			// Cancelling one caller never cancels shared project hydration.
			return new Promise<void>((resolve, reject) => {
				const abort = () => reject(signal.reason);
				signal.addEventListener("abort", abort, { once: true });
				ready
					.then(resolve, reject)
					.finally(() => signal.removeEventListener("abort", abort));
			});
		},
		cancelPending() {
			cancelPreview();
			dirty = false;
		},
	};
}
