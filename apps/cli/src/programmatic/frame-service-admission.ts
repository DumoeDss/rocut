export class FrameAdmissionBusyError extends Error {
	constructor() {
		super("HTML rasterizer busy; retry after the active frame finishes");
		this.name = "FrameAdmissionBusyError";
	}
}

type WaitingFrame = {
	signal: AbortSignal;
	resolve(release: () => void): void;
	reject(reason: unknown): void;
	abort(): void;
};

/** Transport admission only. A lease covers body reading, rendering and actual
 * renderer cleanup; aborting its caller must not release an active lease. */
export function createFrameServiceAdmission() {
	let active = 0;
	const waiting: WaitingFrame[] = [];
	const lease = () => {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			active--;
			while (active < 2 && waiting.length) {
				const next = waiting.shift()!;
				next.signal.removeEventListener("abort", next.abort);
				if (next.signal.aborted) {
					next.reject(next.signal.reason);
					continue;
				}
				active++;
				next.resolve(lease());
			}
		};
	};
	return {
		acquire(signal: AbortSignal): Promise<() => void> {
			if (signal.aborted) return Promise.reject(signal.reason);
			if (active < 2 && waiting.length === 0) {
				active++;
				return Promise.resolve(lease());
			}
			// Keep pending connections bounded; their original route deadline
			// includes queue time rather than restarting when a slot is granted.
			if (waiting.length >= 8)
				return Promise.reject(new FrameAdmissionBusyError());
			return new Promise((resolve, reject) => {
				const next: WaitingFrame = {
					signal,
					resolve,
					reject,
					abort() {
						const index = waiting.indexOf(next);
						if (index >= 0) waiting.splice(index, 1);
						signal.removeEventListener("abort", next.abort);
						reject(signal.reason);
					},
				};
				waiting.push(next);
				signal.addEventListener("abort", next.abort, { once: true });
			});
		},
	};
}
