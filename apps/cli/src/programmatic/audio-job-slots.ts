/** Native IO admission: aborted renderers still own their process slot until
 * cleanup finishes. A bounded replacement queue bridges that drain interval.
 */
export function createNativeAudioSlots() {
	const active = new Set<AbortSignal>();
	const pending: { signal: AbortSignal; grant: (release: () => void) => void; cancel: () => void }[] = [];
	const occupy = (signal: AbortSignal): (() => void) => {
		active.add(signal);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			active.delete(signal);
			const next = pending.shift();
			if (next) {
				next.signal.removeEventListener("abort", next.cancel);
				next.grant(occupy(next.signal));
			}
		};
	};
	return {
		async acquire(signal: AbortSignal): Promise<(() => void) | null> {
			signal.throwIfAborted();
			if (active.size < 2) return occupy(signal);
			// Ordinary overload is still busy; queue only behind cancelled IO.
			if (pending.length >= 2 || ![...active].some(item => item.aborted)) return null;
			return new Promise((resolve, reject) => {
				const waiter = { signal, grant: resolve, cancel: () => {
					const index = pending.indexOf(waiter);
					if (index >= 0) pending.splice(index, 1);
					reject(signal.reason);
				} };
				pending.push(waiter);
				signal.addEventListener("abort", waiter.cancel, { once: true });
			});
		},
	};
}
