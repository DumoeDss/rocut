interface NativeFrameSlot {
	signal: AbortSignal;
}

interface NativeFrameWaiter {
	signal: AbortSignal;
	grant(release: () => void): void;
	reject(reason: unknown): void;
	cancel(): void;
}

/** Cancelled native frames still own their slot until actual cleanup settles.
 * Only their replacements may wait, in a bounded queue; live overload is busy.
 * The route owns cancellation/deadlines/disposal and releases in its finally.
 */
export function createNativeFrameSlots() {
	const active = new Set<NativeFrameSlot>();
	const pending: NativeFrameWaiter[] = [];
	const occupy = (signal: AbortSignal): (() => void) => {
		// A lease is distinct even if a caller happens to reuse an AbortSignal.
		const slot = { signal };
		active.add(slot);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			active.delete(slot);
			while (active.size < 2 && pending.length) {
				const next = pending.shift()!;
				next.signal.removeEventListener("abort", next.cancel);
				if (next.signal.aborted) {
					next.reject(next.signal.reason);
					continue;
				}
				next.grant(occupy(next.signal));
			}
		};
	};
	return {
		async acquire(signal: AbortSignal): Promise<(() => void) | null> {
			signal.throwIfAborted();
			if (active.size < 2) return occupy(signal);
			if (
				pending.length >= 2 ||
				![...active].some((slot) => slot.signal.aborted)
			)
				return null;
			return new Promise((grant, reject) => {
				const waiter: NativeFrameWaiter = {
					signal,
					grant,
					reject,
					cancel: () => {
						const index = pending.indexOf(waiter);
						if (index >= 0) pending.splice(index, 1);
						signal.removeEventListener("abort", waiter.cancel);
						reject(signal.reason);
					},
				};
				pending.push(waiter);
				signal.addEventListener("abort", waiter.cancel, { once: true });
				if (signal.aborted) waiter.cancel();
			});
		},
	};
}
