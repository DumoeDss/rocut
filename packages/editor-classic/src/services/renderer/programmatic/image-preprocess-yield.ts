/** A task hop without nested-timer clamping. One channel belongs to one run. */
export function createImagePreprocessYield(signal: AbortSignal) {
	const channel = new MessageChannel();
	let pending: { resolve(): void; reject(reason: unknown): void } | undefined;
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		signal.removeEventListener("abort", abort);
		channel.port1.onmessage = null;
		channel.port1.close();
		channel.port2.close();
		pending?.reject(signal.reason ?? new DOMException("Yield closed", "AbortError"));
		pending = undefined;
	};
	const abort = () => close();
	channel.port1.onmessage = () => {
		const current = pending;
		pending = undefined;
		current?.resolve();
	};
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) close();
	return {
		wait(): Promise<void> {
			signal.throwIfAborted();
			if (closed) throw Error("Image preprocessing yield closed");
			if (pending) throw Error("Image preprocessing yield already pending");
			return new Promise<void>((resolve, reject) => {
				pending = { resolve, reject };
				channel.port2.postMessage(null);
			});
		},
		close,
	};
}
